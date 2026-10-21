import path from "node:path";

// Shared by the gateway, its mapped-identity child process and native clients.
export function normalizeFileEdit(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("File edit arguments must be an object");
  if (typeof input.path !== "string" || !input.path.trim()) throw new Error("path is required");
  const batch = input.edits != null;
  if (batch && (!Array.isArray(input.edits) || input.edits.length < 1 || input.edits.length > 100)) {
    throw new Error("edits must contain between 1 and 100 replacements");
  }
  if (batch && (input.oldText != null || input.newText != null || input.replaceAll != null || input.expectedOccurrences != null)) {
    throw new Error("Use either edits or the top-level oldText/newText replacement");
  }
  if (input.dryRun != null && typeof input.dryRun !== "boolean") throw new Error("dryRun must be a boolean");
  const edits = (batch ? input.edits : [input]).map((edit, index) => {
    const label = "Edit " + (index + 1) + ": ";
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new Error(label + "replacement must be an object");
    if (typeof edit.oldText !== "string" || edit.oldText.length === 0) throw new Error(label + "oldText must be a nonempty string");
    if (typeof edit.newText !== "string") throw new Error(label + "newText must be a string");
    if (edit.replaceAll != null && typeof edit.replaceAll !== "boolean") throw new Error(label + "replaceAll must be a boolean");
    if (edit.expectedOccurrences != null && (!Number.isSafeInteger(edit.expectedOccurrences) || edit.expectedOccurrences < 1)) {
      throw new Error(label + "expectedOccurrences must be a positive integer");
    }
    return { oldText: edit.oldText, newText: edit.newText, replaceAll: edit.replaceAll === true,
      ...(edit.expectedOccurrences != null ? { expectedOccurrences: edit.expectedOccurrences } : {}) };
  });
  return { path: input.path, edits, dryRun: input.dryRun === true };
}

export function applyFileEdits(content, edits) {
  const results = [];
  let next = content;
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index], first = next.indexOf(edit.oldText), label = "Edit " + (index + 1) + ": ";
    if (first < 0) throw new Error(label + "oldText was not found");
    if (!edit.replaceAll && next.indexOf(edit.oldText, first + 1) >= 0) {
      throw new Error(label + "oldText is not unique; pass a unique snippet or set replaceAll=true");
    }
    const chunks = edit.replaceAll ? next.split(edit.oldText) : null;
    const replacements = chunks ? chunks.length - 1 : 1;
    if (edit.expectedOccurrences != null && edit.expectedOccurrences !== replacements) {
      throw new Error(label + "expected " + edit.expectedOccurrences + " occurrences, found " + replacements);
    }
    results.push({ index: index + 1, replacements, firstLine: next.slice(0, first).split("\n").length });
    next = chunks ? chunks.join(edit.newText) : next.slice(0, first) + edit.newText + next.slice(first + edit.oldText.length);
  }
  return { content: next, edits: results, replacements: results.reduce((n, edit) => n + edit.replacements, 0) };
}

export function executeFileEdit(fs, input, captureSnapshot = false) {
  const request = normalizeFileEdit(input);
  const file = fs.realpathSync(request.path);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("path must refer to a regular file");
  if (stat.size > 32 * 1024 * 1024) throw new Error("File edits are limited to 32 MiB");
  const original = fs.readFileSync(file), content = original.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(original)) throw new Error("File is not valid UTF-8");
  const plan = applyFileEdits(content, request.edits);
  const wouldChange = plan.content !== content;
  if (wouldChange && !request.dryRun) {
    if (stat.nlink > 1) throw new Error("Atomic editing of hard-linked files is not supported");
    fs.accessSync(file, fs.constants.W_OK);
    const temp = file + ".metis-edit-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    let fd;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, plan.content, "utf8");
      if (process.platform !== "win32") fs.fchownSync(fd, stat.uid, stat.gid);
      fs.fchmodSync(fd, stat.mode & 0o777);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      const current = fs.statSync(file);
      if (current.dev !== stat.dev || current.ino !== stat.ino || !fs.readFileSync(file).equals(original)) {
        throw new Error("File changed while preparing the edit; read it again before retrying");
      }
      fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch { /* Cleanup must not hide the primary edit error. */ }
    }
  }
  return { path: file, replacements: plan.replacements, bytes: Buffer.byteLength(plan.content, "utf8"),
    changed: wouldChange && !request.dryRun, wouldChange, dryRun: request.dryRun, edits: plan.edits,
    ...(captureSnapshot && wouldChange && !request.dryRun && content.length + plan.content.length <= 2_000_000
      ? { fileSnapshot: { before: content, after: plan.content } } : {}) };
}

export function buildFileEditProgram(input, captureSnapshot = false) {
  const request = normalizeFileEdit(input);
  return "const fs=require('node:fs');\n" + normalizeFileEdit.toString() + "\n" + applyFileEdits.toString() + "\n" +
    executeFileEdit.toString() + "\nconsole.log(JSON.stringify(executeFileEdit(fs,JSON.parse(Buffer.from('" +
    Buffer.from(JSON.stringify(request), "utf8").toString("base64") + "','base64').toString('utf8'))," + JSON.stringify(captureSnapshot) + ")));";
}

export function executeFileWrite(fs, input, captureSnapshot = false) {
  if (typeof input.path !== "string" || !input.path.trim()) throw new Error("Path is required");
  if (typeof input.content !== "string") throw new Error("Content is required");
  let before;
  if (captureSnapshot) {
    try {
      const stat = fs.statSync(input.path);
      if (stat.isFile() && stat.size <= 8_000_000) {
        const bytes = fs.readFileSync(input.path), text = bytes.toString("utf8");
        if (!text.includes("\0") && Buffer.from(text, "utf8").equals(bytes)) before = text;
      }
    } catch (error) {
      if (error.code === "ENOENT") before = null;
    }
  }
  fs.mkdirSync(path.dirname(input.path), { recursive: true });
  fs.writeFileSync(input.path, input.content, "utf8");
  const changed = before === undefined || before !== input.content;
  return { path: input.path, bytes: Buffer.byteLength(input.content, "utf8"), changed,
    ...(captureSnapshot && changed && before !== undefined && !input.content.includes("\0")
      && (before?.length || 0) + input.content.length <= 2_000_000
      ? { fileSnapshot: { before, after: input.content } } : {}) };
}

export function buildFileWriteProgram(input, captureSnapshot = false) {
  return "const fs=require('node:fs'),path=require('node:path');\n" + executeFileWrite.toString()
    + "\nconsole.log(JSON.stringify(executeFileWrite(fs,JSON.parse(Buffer.from('"
    + Buffer.from(JSON.stringify(input), "utf8").toString("base64")
    + "','base64').toString('utf8'))," + JSON.stringify(captureSnapshot) + ")));";
}

export const FILE_EDIT_PROPERTIES = {
  path: { type: "string" },
  oldText: { type: "string", description: "One exact nonempty snippet to replace. Use this and newText, or edits." },
  newText: { type: "string" },
  edits: { type: "array", minItems: 1, maxItems: 100, description: "Ordered replacements in one file. Later edits see earlier replacements. All are checked before the file is written.",
    items: { type: "object", properties: {
      oldText: { type: "string", minLength: 1 }, newText: { type: "string" },
      replaceAll: { type: "boolean", description: "Explicitly replace every nonoverlapping occurrence. Default requires a unique snippet." },
      expectedOccurrences: { type: "integer", minimum: 1, description: "Require exactly this many replacements." },
    }, required: ["oldText", "newText"], additionalProperties: false } },
  replaceAll: { type: "boolean", description: "For the single oldText/newText form, explicitly replace all occurrences." },
  expectedOccurrences: { type: "integer", minimum: 1 },
  dryRun: { type: "boolean", description: "Validate every replacement and report counts without writing the file." },
};
export const FILE_EDIT_DESCRIPTION = "Edit a UTF-8 file using oldText/newText or an ordered edits array. Use small exact snippets. All replacements are validated before one atomic write; a failed match leaves the file unchanged. Use replaceAll explicitly for repeated snippets, expectedOccurrences to check counts, and dryRun for a check without writing. Reports replacement counts and first matching lines.";
