     1	import { execFile } from "node:child_process";
     2	import { access, readFile, mkdtemp, rm, writeFile, cp, rename } from "node:fs/promises";
     3	import os from "node:os";
     4	import path from "node:path";
     5	import { promisify } from "node:util";
     6	import {
     7	  loadReleaseManifest,
     8	  normalizeReleaseTag,
     9	  versionFromReleaseTag,
    10	  type ReleaseManifest,
    11	} from "@/lib/release-manifest";
    12	import {
    13	  commitChannelUpdateAvailable,
    14	  sameGitSha,
    15	  type UpdateCommitItem,
    16	  type UpdateReleaseItem,
    17	  type UpdateVersionList,
    18	} from "@/lib/update-display";
    19	
    20	export {
    21	  commitChannelUpdateAvailable,
    22	  formatUpdateInstalledLabel,
    23	  sameGitSha,
    24	  shortGitSha,
    25	} from "@/lib/update-display";
    26	export type { UpdateCommitItem, UpdateReleaseItem, UpdateVersionList } from "@/lib/update-display";
    27	
    28	const execFileAsync = promisify(execFile);
    29	
    30	async function resolvePnpm(root: string) {
    31	  if (process.env.PNPM_BIN) return process.env.PNPM_BIN;
    32	  const installedPnpm = path.join(root, ".runtime", "pnpm", "bin", "pnpm");
    33	  try {
    34	    await access(installedPnpm);
    35	    return installedPnpm;
    36	  } catch {
    37	    return "pnpm";
    38	  }
    39	}
    40	const RELEASE_URL = "https://api.github.com/repos/f1shyondrugs/metis-ai/releases/latest";
    41	const COMMIT_URL = "https://api.github.com/repos/f1shyondrugs/metis-ai/commits/master";
    42	const USER_AGENT = "metis-ai-update-checker";
    43	const cache: { etag?: string; release?: GithubRelease; checkedAt?: number } = {};
    44	const CACHE_TTL_MS = 5 * 60_000;
    45	
    46	export type GithubReleaseAsset = {
    47	  name: string;
    48	  browser_download_url: string;
    49	  content_type?: string;
    50	  size?: number;
    51	};
    52	
    53	export type GithubRelease = {
    54	  tag_name: string;
    55	  target_commitish?: string;
    56	  name?: string;
    57	  body?: string;
    58	  html_url?: string;
    59	  published_at?: string;
    60	  prerelease?: boolean;
    61	  draft?: boolean;
    62	  assets?: GithubReleaseAsset[];
    63	};
    64	
    65	export type UpdateChannel = "releases" | "commits";
    66	export type UpdateStatus = "development" | "up-to-date" | "available" | "commit-available";
    67	
    68	export type GithubCommit = {
    69	  sha: string;
    70	  html_url?: string;
    71	  commit?: {
    72	    message?: string;
    73	    author?: { name?: string; date?: string };
    74	    committer?: { name?: string; date?: string };
    75	  };
    76	  author?: { login?: string };
    77	};
    78	
    79	export type UpdateCheck = {
    80	  channel: UpdateChannel;
    81	  status: UpdateStatus;
    82	  latestTag: string;
    83	  latestCommit?: string;
    84	  commitUrl?: string;
    85	  commitMessage?: string;
    86	  currentRef: string;
    87	  currentManifest: ReleaseManifest;
    88	  updateAvailable: boolean;
    89	  release?: GithubRelease;
    90	};
    91	
    92	export async function fetchLatestRelease(fetcher: typeof fetch = fetch): Promise<GithubRelease> {
    93	  const now = Date.now();
    94	  if (cache.release && cache.checkedAt && now - cache.checkedAt < CACHE_TTL_MS) return cache.release;
    95	  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" };
    96	  if (cache.etag) headers["If-None-Match"] = cache.etag;
    97	  const response = await fetcher(RELEASE_URL, { headers, cache: "no-store" });
    98	  if (response.status === 304 && cache.release) {
    99	    cache.checkedAt = now;
   100	    return cache.release;
   101	  }
   102	  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);
   103	  const release = (await response.json()) as GithubRelease;
   104	  if (!normalizeReleaseTag(release.tag_name)) throw new Error("GitHub returned a release without a valid SemVer tag.");
   105	  if (release.draft || release.prerelease) throw new Error("GitHub returned a non-stable release for the stable channel.");
   106	  cache.etag = response.headers.get("etag") || cache.etag;
   107	  cache.release = release;
   108	  cache.checkedAt = now;
   109	  return release;
   110	}
   111	
   112	export async function fetchLatestCommit(fetcher: typeof fetch = fetch): Promise<GithubCommit> {
   113	  const response = await fetcher(COMMIT_URL, {
   114	    headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
   115	    cache: "no-store",
   116	  });
   117	  if (!response.ok) throw new Error(`GitHub commit lookup failed (${response.status}).`);
   118	  const commit = (await response.json()) as GithubCommit;
   119	  if (!commit.sha) throw new Error("GitHub returned a commit without a SHA.");
   120	  return commit;
   121	}
   122	
   123	const githubHeaders = () => ({ "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" });
   124	
   125	export function isGitCommitSha(value: string): boolean {
   126	  return /^[0-9a-f]{7,40}$/i.test(value.trim());
   127	}
   128	
   129	function splitCommitMessage(message?: string) {
   130	  const text = message?.trim() || "";
   131	  const [title, ...rest] = text.split(/\n/);
   132	  return { title: title || "Untitled commit", body: rest.join("\n").trim() };
   133	}
   134	
   135	export async function fetchReleaseByTag(tag: string, fetcher: typeof fetch = fetch): Promise<GithubRelease> {
   136	  const normalized = normalizeReleaseTag(tag);
   137	  if (!normalized) throw new Error("Release tag must look like v1.0.0.");
   138	  const response = await fetcher(`https://api.github.com/repos/f1shyondrugs/metis-ai/releases/tags/${encodeURIComponent(normalized)}`, {
   139	    headers: githubHeaders(),
   140	    cache: "no-store",
   141	  });
   142	  if (!response.ok) throw new Error(`GitHub release ${normalized} was not found (${response.status}).`);
   143	  const release = (await response.json()) as GithubRelease;
   144	  if (release.draft) throw new Error(`GitHub release ${normalized} is a draft.`);
   145	  return release;
   146	}
   147	
   148	export async function fetchCommitBySha(sha: string, fetcher: typeof fetch = fetch): Promise<GithubCommit> {
   149	  const value = sha.trim();
   150	  if (!isGitCommitSha(value)) throw new Error("Commit must be a git SHA.");
   151	  const response = await fetcher(`https://api.github.com/repos/f1shyondrugs/metis-ai/commits/${encodeURIComponent(value)}`, {
   152	    headers: githubHeaders(),
   153	    cache: "no-store",
   154	  });
   155	  if (!response.ok) throw new Error(`GitHub commit ${value.slice(0, 12)} was not found (${response.status}).`);
   156	  const commit = (await response.json()) as GithubCommit;
   157	  if (!commit.sha) throw new Error("GitHub returned a commit without a SHA.");
   158	  return commit;
   159	}
   160	
   161	export async function listUpdateVersions(root: string, fetcher: typeof fetch = fetch): Promise<UpdateVersionList> {
   162	  const manifest = await loadReleaseManifest(root);
   163	  const head = await resolveCurrentGitHead(root);
   164	  const currentCommit = head || manifest.commit || null;
   165	  const currentTag = manifest.tag || null;
   166	  const [releasesResponse, commitsResponse] = await Promise.all([
   167	    fetcher("https://api.github.com/repos/f1shyondrugs/metis-ai/releases?per_page=20", { headers: githubHeaders(), cache: "no-store" }),
   168	    fetcher("https://api.github.com/repos/f1shyondrugs/metis-ai/commits?sha=master&per_page=30", { headers: githubHeaders(), cache: "no-store" }),
   169	  ]);
   170	  if (!releasesResponse.ok) throw new Error(`GitHub release list failed (${releasesResponse.status}).`);
   171	  if (!commitsResponse.ok) throw new Error(`GitHub commit list failed (${commitsResponse.status}).`);
   172	  const rawReleases = (await releasesResponse.json()) as GithubRelease[];
   173	  const rawCommits = (await commitsResponse.json()) as GithubCommit[];
   174	  const releases = (Array.isArray(rawReleases) ? rawReleases : [])
   175	    .filter((release) => !release.draft && normalizeReleaseTag(release.tag_name))
   176	    .map((release) => {
   177	      const tag = normalizeReleaseTag(release.tag_name) || release.tag_name;
   178	      return {
   179	        tag,
   180	        name: release.name?.trim() || tag,
   181	        body: release.body?.trim() || "",
   182	        htmlUrl: release.html_url || `https://github.com/f1shyondrugs/metis-ai/releases/tag/${encodeURIComponent(tag)}`,
   183	        publishedAt: release.published_at || null,
   184	        prerelease: Boolean(release.prerelease),
   185	        current: Boolean(currentTag && tag === currentTag),
   186	      } satisfies UpdateReleaseItem;
   187	    });
   188	  const commits = (Array.isArray(rawCommits) ? rawCommits : [])
   189	    .filter((commit) => commit.sha)
   190	    .map((commit) => {
   191	      const split = splitCommitMessage(commit.commit?.message);
   192	      return {
   193	        sha: commit.sha,
   194	        shortSha: commit.sha.slice(0, 12),
   195	        title: split.title,
   196	        body: split.body,
   197	        htmlUrl: commit.html_url || `https://github.com/f1shyondrugs/metis-ai/commit/${commit.sha}`,
   198	        authoredAt: commit.commit?.author?.date || commit.commit?.committer?.date || null,
   199	        author: commit.commit?.author?.name || commit.author?.login || null,
   200	        current: sameGitSha(commit.sha, currentCommit),
