#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pnpm release vX.Y.Z[-prerelease]

Creates the tag, builds the release assets and publishes the GitHub release
and GHCR image using the locally authenticated GitHub account.
EOF
}

tag="${1:-}"
if [[ "$tag" == "-h" || "$tag" == "--help" || -z "$tag" ]]; then
  usage
  [[ -n "$tag" ]] && exit 0
  exit 2
fi

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo "Invalid release tag: $tag" >&2
  exit 2
}

expected_version="${tag#v}"
package_version="$(node -p 'require("./package.json").version')"
[[ "$package_version" == "$expected_version" ]] || {
  echo "package.json is $package_version but the tag is $tag" >&2
  exit 2
}

command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
gh auth status >/dev/null
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo%%/*}"
login="$(gh api user --jq .login)"
[[ "$login" == "$owner" ]] || {
  echo "GitHub login $login does not match repository owner $owner" >&2
  exit 2
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before releasing." >&2
  exit 2
fi
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag already exists locally: $tag" >&2
  exit 2
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  echo "Tag already exists on origin: $tag" >&2
  exit 2
fi

echo "Running release checks as $(git config user.name) <$(git config user.email)>"
pnpm test:release
pnpm exec tsx --test tests/release-manifest.test.ts tests/github-releases.test.ts

commit="$(git rev-parse HEAD)"
METIS_RELEASE_TAG="$tag" \
METIS_RELEASE_VERSION="$expected_version" \
METIS_RELEASE_COMMIT="$commit" \
pnpm build

git tag -a "$tag" -m "Metis AI $tag"
git push origin HEAD:master "$tag"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/metis-release.XXXXXX")"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

version="${tag#v}"
git archive --format=tar.gz --prefix="metis-ai-${version}/" "$tag" > "$work_dir/metis-ai-${tag}.tar.gz"
cp public/install/install.sh "$work_dir/metis-install.sh"
cp public/install/install.ps1 "$work_dir/metis-install.ps1"
cp public/install/docker.sh "$work_dir/metis-docker-install.sh"
sha256sum "$work_dir/metis-ai-${tag}.tar.gz" "$work_dir/metis-install.sh" "$work_dir/metis-install.ps1" "$work_dir/metis-docker-install.sh" > "$work_dir/SHA256SUMS"

image="ghcr.io/${repo,,}"
gh auth token | docker login ghcr.io --username "$owner" --password-stdin >/dev/null
docker buildx build --push \
  --tag "${image}:${tag}" \
  --tag "${image}:latest" \
  --label "org.opencontainers.image.version=${tag}" \
  --label "org.opencontainers.image.revision=$commit" \
  --build-arg "METIS_RELEASE_TAG=${tag}" \
  --build-arg "METIS_RELEASE_VERSION=${tag}" \
  --build-arg "METIS_RELEASE_COMMIT=$commit" .

notes_file="$work_dir/release-notes.md"
{
  echo "## What's new"
  echo
  git log --format='- %s' "${tag}^".."$tag"
  echo
  echo "## How to install"
  echo
  echo '```bash'
  echo "curl -fsSL https://github.com/${owner}/metis-ai/releases/latest/download/metis-docker-install.sh -o metis-docker-install.sh"
  echo "bash metis-docker-install.sh --version ${tag}"
  echo '```'
  echo
  echo "See [CHANGELOG.md](https://github.com/${owner}/metis-ai/blob/${tag}/CHANGELOG.md) for the full changelog."
} > "$notes_file"

gh release create "$tag" \
  --title "Metis AI ${tag}" \
  --notes-file "$notes_file" \
  "$work_dir/metis-ai-${tag}.tar.gz" \
  "$work_dir/metis-install.sh" \
  "$work_dir/metis-install.ps1" \
  "$work_dir/metis-docker-install.sh" \
  "$work_dir/SHA256SUMS"

echo "Published ${tag} as ${owner}."
