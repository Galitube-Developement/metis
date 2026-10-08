import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

for (const platform of ["linux", "macos"]) {
  const source = readFileSync(new URL(`../install/${platform}.sh`, import.meta.url), "utf8");
  function body(name: string) {
    const start = source.indexOf(name + "() {");
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf("\n}\n", start) + 3);
  }
  const parseEnd = source.indexOf("\nread_tty_line() {");
  const prefix = source.slice(0, parseEnd);
  function parse(args: string[], home = "/root") {
    return execFileSync("/bin/bash", ["-c", prefix + '\nprintf "%s" "$allow_root_agents"', "installer", ...args], {
      encoding: "utf8", env: { ...process.env, HOME: home },
    });
  }
  test(`${platform}: fresh root and root-home installs deny root agents; CLI opt-in is noninteractive`, () => {
    for (const home of ["/root", "/var/root", "/home/service"]) {
      assert.equal(parse(["--non-interactive"], home), "false");
    }
    assert.equal(parse(["--non-interactive", "--allow-root-agents"]), "true");
    const help = execFileSync("/bin/bash", ["-c", prefix, "installer", "--help"], { encoding: "utf8" });
    assert.match(help, /--allow-root-agents.*default: false/);
    assert.match(help, /dedicated unprivileged service user/);
    assert.match(help, /separate OS users/);
    assert.match(source, /Warning: --allow-root-agents permits agents with root privileges/);
    assert.doesNotMatch(source, /uid_now|AI_CHAT_ALLOW_ROOT_AGENTS=true/);
  });
  test(`${platform}: generated env defaults false for native and Docker; upgrades keep explicit settings`, () => {
    const start = source.indexOf('  write_env_line APP_NAME "Metis AI"');
    const end = source.indexOf('} > "$install_dir/.env"', start);
    const template = source.slice(start, end);
    const dir = mkdtempSync(path.join(os.tmpdir(), "metis-installer-security-"));
    try {
      for (const docker of [0, 1]) {
        for (const optIn of ["false", "true"]) {
          const generated = execFileSync("/bin/bash", ["-c", body("write_env_line") +
            '\nallow_root_agents="$1"; use_docker="$2"\n{\n' + template + "\n}\n", "fixture", optIn, String(docker)], { encoding: "utf8" });
          assert.match(generated, new RegExp('AI_CHAT_ALLOW_ROOT_AGENTS="' + optIn + '"'));
          for (const previous of [undefined, "false", "true"]) {
            const dest = path.join(dir, "new.env"), old = path.join(dir, "old.env");
            writeFileSync(dest, generated);
            writeFileSync(old, previous === undefined ? "CUSTOM=kept\n" : `AI_CHAT_ALLOW_ROOT_AGENTS="${previous}"\n`);
            execFileSync("/bin/bash", ["-c", body("merge_preserved_env") +
              '\nREPLACE_ENV_STASH="$1"; merge_preserved_env "$2"', "fixture", old, dest]);
            const merged = readFileSync(dest, "utf8");
            assert.match(merged, new RegExp('AI_CHAT_ALLOW_ROOT_AGENTS="' + (previous ?? optIn) + '"'));
          }
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test(`${platform}: setup guidance references a local file without reading or logging its secret`, () => {
    const tail = source.slice(source.lastIndexOf("installed successfully."));
    assert.match(tail, /setup token.*local file: %s/);
    assert.match(tail, /"\$data_dir\/setup-token"/);
    assert.doesNotMatch(tail, /cat |read_env_key|setup_token|SETUP_TOKEN/);
  });
}
test("Linux keeps portable caller-owned systemd services", () => {
  const source = readFileSync(new URL("../install/linux.sh", import.meta.url), "utf8");
  assert.match(source, /User=\$USER\nGroup=\$\(id -gn\)/);
  assert.match(source, /Environment=HOME=\$HOME/);
  assert.match(source, /run_privileged tee/);
});
