import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const root = new URL("..", import.meta.url).pathname;

function run(args, mode = "ok", os = "Linux", entry = "install.sh") {
  const dir = mkdtempSync(join(tmpdir(), "metis-bootstrap-contract-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const tool of ["systemctl", "ss", "lsof"]) writeFileSync(join(bin, tool), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const platform = '#!/usr/bin/env bash\n# Metis AI test installer\nprintf "%s\\n" "$@" > "$METIS_TEST_ARGS"\n';
  const digest = createHash("sha256").update(platform).digest("hex");
  writeFileSync(join(dir, "platform"), platform);
  writeFileSync(join(bin, "uname"), '#!/bin/sh\necho "' + os + '"\n', { mode: 0o755 });
  writeFileSync(join(bin, "curl"), [
    "#!/bin/bash",
    'url=""; out=""',
    'while (( $# )); do case "$1" in -o) out="$2"; shift 2;; *) url="$1"; shift;; esac; done',
    'printf "%s\\n" "$url" >> "$METIS_TEST_CALLS"',
    'if [[ "$url" == */releases/latest ]]; then',
    '  [[ "$METIS_TEST_MODE" != api404 && "$METIS_TEST_MODE" != api403 ]] || exit 22',
    '  count="$(wc -l < "$METIS_TEST_CALLS")"; tag=v9.8.7; [[ "$count" -gt 1 ]] && tag=v9.9.9',
    '  printf \'{"tag_name":"%s","assets":[{"name":"SHA256SUMS"}]}\' "$tag"; exit 0',
    'fi',
    'if [[ "$url" == */releases/tags/* ]]; then [[ "$METIS_TEST_MODE" != api404 && "$METIS_TEST_MODE" != api403 ]] || exit 22; printf \'{"assets":[{"name":"SHA256SUMS"}]}\'; exit 0; fi',
    '[[ "$METIS_TEST_MODE" != 404 && "$METIS_TEST_MODE" != 403 ]] || exit 22',
    'if [[ "$url" == */SHA256SUMS ]]; then',
    '  [[ "$METIS_TEST_MODE" != missing-sums ]] || exit 22',
    '  digest="' + digest + '"; [[ "$METIS_TEST_MODE" == corrupt ]] && digest="' + "0".repeat(64) + '"',
    '  printf "%s  metis-linux.sh\\n%s  metis-macos.sh\\n" "$digest" "$digest"; exit 0',
    'fi',
    'if [[ "$METIS_TEST_MODE" == missing ]]; then printf "invalid installer" > "$out"; else cp "$METIS_TEST_PLATFORM" "$out"; fi',
  ].join("\n") + "\n", { mode: 0o755 });
  try {
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH, METIS_AI_INSTALL_BASE: "",
      METIS_TEST_PLATFORM: join(dir, "platform"), METIS_TEST_ARGS: join(dir, "args"),
      METIS_TEST_CALLS: join(dir, "calls"), METIS_TEST_MODE: mode, TMPDIR: dir };
    const result = spawnSync("/bin/bash", [join(root, entry), ...args, ...(entry === "install.sh" ? [] : ["--install-dir", join(dir, "installation")])], { cwd: root, env, encoding: "utf8" });
    return { ...result, mutatedInstallation: existsSync(join(dir, "installation")), args: existsSync(join(dir, "args")) ? readFileSync(join(dir, "args"), "utf8").trim().split("\n") : null,
      calls: existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n") : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("default/latest freeze the stable tag once, including checksum and platform URL on Linux and macOS", () => {
  for (const os of ["Linux", "Darwin"]) for (const args of [[], ["--version", "latest"]]) {
    const result = run(args, "ok", os);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.args, ["--version", "v9.8.7"]);
    assert.equal(result.calls.filter(url => url.endsWith("/releases/latest")).length, 1);
    assert.ok(result.calls.some(url => url.endsWith("/releases/download/v9.8.7/" + (os === "Linux" ? "metis-linux.sh" : "metis-macos.sh"))));
    assert.ok(result.calls.some(url => url.endsWith("/releases/download/v9.8.7/SHA256SUMS")));
    assert.equal(result.calls.some(url => url.includes("/master/") || url.includes("v9.9.9")), false);
  }
});

test("explicit old tag and development commit use exactly that ref", () => {
  const release = run(["--version", "v1.2.3", "--docker"]);
  assert.equal(release.status, 0, release.stderr);
  assert.deepEqual(release.args, ["--docker", "--version", "v1.2.3"]);
  assert.ok(release.calls.every(url => url.includes("/v1.2.3/")));
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const commit = run(["--commit", sha]);
  assert.equal(commit.status, 0, commit.stderr);
  assert.deepEqual(commit.args, ["--commit", sha]);
  assert.deepEqual(commit.calls, ["https://raw.githubusercontent.com/f1shyondrugs/metis-ai/" + sha + "/install/linux.sh"]);
});

test("API errors, missing downloads/checksums and checksum mismatches never execute a platform", () => {
  for (const mode of ["api404", "api403", "404", "403", "missing", "missing-sums", "corrupt"]) {
    const result = run([], mode);
    assert.notEqual(result.status, 0, mode);
    assert.equal(result.args, null, mode);
  }
});

test("mixed commit/release flags in either order and missing values fail before downloads", () => {
  for (const args of [["--commit", "abcdef1", "--version", "latest"], ["--version", "v1.2.3", "--commit", "abcdef1"], ["--version"], ["--commit"], ["--commit", "master"]]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
    assert.equal(result.args, null);
  }
});

test("uninstall flags pass through without an installation version argument", () => {
  const result = run(["uninstall", "--yes", "--keep-data"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.args, ["uninstall", "--yes", "--keep-data"]);
  assert.ok(result.calls.some(url => url.includes("/v9.8.7/install/linux.sh")));
  for (const mode of ["api403", "api404"]) {
    const failure = run(["uninstall", "--yes", "--keep-data"], mode);
    assert.notEqual(failure.status, 0);
    assert.equal(failure.args, null);
    assert.equal(failure.calls.length, 1);
  }
});

test("direct native Unix installers freeze stable latest before any installation changes", () => {
  for (const [os, entry] of [["Linux", "install/linux.sh"], ["Darwin", "install/macos.sh"]]) {
    for (const args of [[], ["--version", "latest"], ["--version", "v1.2.3"]]) {
      const result = run([...args, "--dry-run", "--non-interactive"], "ok", os, entry);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp("version: +"+ (args[1] === "v1.2.3" ? "v1.2.3" : "v9.8.7")));
      assert.equal(result.calls.filter(url => url.endsWith("/releases/latest")).length, args[1] === "v1.2.3" ? 0 : 1);
      assert.equal(result.mutatedInstallation, false);
    }
    for (const mode of ["api404", "api403"]) {
      const result = run(["--dry-run", "--non-interactive"], mode, os, entry);
      assert.notEqual(result.status, 0);
      assert.equal(result.mutatedInstallation, false);
    }
  }
});
