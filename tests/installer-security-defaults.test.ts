import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  test(`${platform}: fresh installs enable root agents without a flag; CLI opt-out is noninteractive`, () => {
    for (const home of ["/root", "/var/root", "/home/service"]) {
      assert.equal(parse(["--non-interactive"], home), "true");
    }
    assert.equal(parse(["--non-interactive", "--allow-root-agents"]), "true");
    assert.equal(parse(["--non-interactive", "--deny-root-agents"]), "false");
    const help = execFileSync("/bin/bash", ["-c", prefix, "installer", "--help"], { encoding: "utf8" });
    assert.match(help, /--allow-root-agents.*default: true/);
    assert.match(help, /dedicated unprivileged service user/);
    assert.match(help, /separate OS users/);
    assert.doesNotMatch(source, /Allow the admin.s agents to run as root/);
    assert.doesNotMatch(source, /uid_now|AI_CHAT_ALLOW_ROOT_AGENTS=true/);
  });
  test(`${platform}: generated env defaults true for native and Docker; upgrades keep explicit settings`, () => {
    const start = source.indexOf('  write_env_line APP_NAME "Metis AI"');
    const end = source.indexOf('} > "$install_dir/.env"', start);
    const template = source.slice(start, end);
    const dir = mkdtempSync(path.join(os.tmpdir(), "metis-installer-security-"));
    try {
      for (const docker of [0, 1]) {
        for (const optIn of [parse([]), parse(["--deny-root-agents"])]) {
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
  test(`${platform}: root defaults never prompt and existing opt-outs remain effective`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "metis-root-default-"));
    const run = (args: string[], previous?: string) => {
      const envFile = path.join(dir, ".env");
      if (previous !== undefined) writeFileSync(envFile, `AI_CHAT_ALLOW_ROOT_AGENTS="${previous}"\n`);
      else if (existsSync(envFile)) rmSync(envFile);
      return execFileSync("/bin/bash", ["-c", prefix + "\n" + body("configure_root_agents") + `
        install_dir="$ROOT_TEST_DIR"
        read_tty_line() { exit 97; }
        configure_root_agents
        printf '%s' "$allow_root_agents"
      `, "fixture", ...args], { encoding: "utf8", env: {...process.env, ROOT_TEST_DIR:dir} });
    };
    try {
      assert.equal(run([]), "true");
      assert.equal(run(["--non-interactive"]), "true");
      assert.equal(run(["--deny-root-agents"]), "false");
      assert.equal(run([], "false"), "false");
      assert.equal(run([], "true"), "true");
      assert.equal(run(["--allow-root-agents"], "false"), "true");
      assert.equal(run(["--deny-root-agents"], "true"), "false");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test(`${platform}: explicit root flags override previous settings while unrelated values survive`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "metis-root-upgrade-"));
    try {
      for (const [flag, previous, expected] of [
        ["--allow-root-agents", "false", "true"], ["--deny-root-agents", "true", "false"],
      ]) {
        const old = path.join(dir, "old.env"), dest = path.join(dir, "new.env");
        writeFileSync(old, `AI_CHAT_ALLOW_ROOT_AGENTS="${previous}"\nCUSTOM=preserved\n`);
        writeFileSync(dest, `AI_CHAT_ALLOW_ROOT_AGENTS="${expected}"\nCUSTOM=new\n`);
        execFileSync("/bin/bash", ["-c", prefix + "\n" + body("merge_preserved_env") + `
          REPLACE_ENV_STASH="$ROOT_TEST_OLD"; merge_preserved_env "$ROOT_TEST_DEST"
        `, "fixture", "--non-interactive", flag], { encoding: "utf8", env: {...process.env, ROOT_TEST_OLD:old, ROOT_TEST_DEST:dest} });
        const merged = readFileSync(dest, "utf8");
        assert.match(merged, new RegExp('AI_CHAT_ALLOW_ROOT_AGENTS="'+expected+'"'));
        assert.match(merged, /CUSTOM=preserved/);
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
