// Fixed child program kept as source text so bundlers cannot inject closure helpers.
const operation = String.raw`function executeFileIO(fs, crypto, path, input) {
  let temporary, lock, ownsLock = false;
  const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
  try {
    const realRoot = fs.realpathSync(input.root), target = fs.realpathSync(input.path);
    const relative = path.relative(realRoot, target);
    if (!relative || (relative === ".." || relative.startsWith(".." + path.sep)) || path.isAbsolute(relative)) return { status: 403, error: "Path must be inside the agent workspace." };
    const read = () => {
      const fd = fs.openSync(target, "r");
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw Object.assign(new Error("Choose a regular text file."), { code: "EISDIR" });
        if (stat.size > 2_000_000) throw Object.assign(new Error("This file exceeds the editor's 2 MB limit."), { code: "ETOOBIG" });
        const bytes = fs.readFileSync(fd);
        if (bytes.length > 2_000_000) throw Object.assign(new Error("This file exceeds the editor's 2 MB limit."), { code: "ETOOBIG" });
        if (bytes.includes(0)) throw Object.assign(new Error("This is a binary file."), { code: "EBINARY" });
        const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { content, revision: digest(bytes), mode: stat.mode & 0o777, ino: stat.ino, dev: stat.dev };
      } finally { fs.closeSync(fd); }
    };
    if (input.action === "snapshot") {
      const current = read();
      return input.revision === current.revision ? { status: 200, revision: current.revision, unchanged: true }
        : { status: 200, content: current.content, revision: current.revision };
    }
    if (!/^[a-f0-9]{64}$/.test(input.revision || "") || typeof input.content !== "string") return { status: 400, error: "A file revision and content are required." };
    const bytes = Buffer.from(input.content, "utf8");
    if (bytes.length > 2_000_000 || bytes.includes(0)) return { status: 413, error: "Save a text file of up to 2 MB." };
    fs.accessSync(target, fs.constants.W_OK);
    lock = path.join(path.dirname(target), ".metis-edit-" + crypto.createHash("sha256").update(target).digest("hex").slice(0, 20) + ".lock");
    const acquire = () => {
      const fd = fs.openSync(lock, "wx", 0o600);
      ownsLock = true;
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); } finally { fs.closeSync(fd); }
    };
    try { acquire(); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Recover only our own lock when its writer is confirmed dead.
      try {
        const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (cause) {
            if (cause.code === "ESRCH") {
              const stat = fs.lstatSync(lock);
              if (!stat.isSymbolicLink() && (typeof process.getuid !== "function" || stat.uid === process.getuid())) fs.unlinkSync(lock);
            }
          }
        }
      } catch {}
      try { acquire(); } catch { return { status: 409, error: "Another save is in progress. Retry after syncing the file.", busy: true }; }
    }
    const current = read();
    if (current.revision !== input.revision) return { status: 409, error: "The file changed on disk.", content: current.content, revision: current.revision };
    temporary = path.join(path.dirname(target), ".metis-save-" + crypto.randomUUID());
    const fd = fs.openSync(temporary, "wx", current.mode);
    try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, current.mode); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const latest = read();
    if (latest.revision !== current.revision || latest.ino !== current.ino || latest.dev !== current.dev || fs.realpathSync(input.path) !== target) {
      return { status: 409, error: "The file changed while saving.", content: latest.content, revision: latest.revision };
    }
    fs.renameSync(temporary, target); temporary = undefined;
    return { status: 200, revision: digest(bytes), content: input.content };
  } catch (error) {
    const code = error.code;
    return { status: code === "ENOENT" ? 404 : code === "EACCES" || code === "EPERM" ? 403 : code === "ETOOBIG" ? 413 : code === "EBINARY" || error instanceof TypeError ? 415 : code === "EISDIR" ? 400 : 502,
      error: code === "ENOENT" ? "The file was deleted or moved on disk. Your editor contents are preserved." : error.message };
  } finally {
    if (temporary) try { fs.unlinkSync(temporary); } catch {}
    if (ownsLock && lock) try { fs.unlinkSync(lock); } catch {}
  }
}

`;
export function buildFileIOProgram(input) {
  return "const runFileIO=(" + operation + ");console.log(JSON.stringify(runFileIO(require('node:fs'),require('node:crypto'),require('node:path'),JSON.parse(Buffer.from('" +
    Buffer.from(JSON.stringify(input)).toString("base64") + "','base64').toString('utf8')))));";
}
