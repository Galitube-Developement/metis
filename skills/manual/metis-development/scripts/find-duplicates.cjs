#!/usr/bin/env node
// Report exact function-body copies. This is a candidate finder, not proof of equivalent semantics.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");

const root = cp.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) => cp.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const scopes = process.argv.slice(2);
const files = [...new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "--",
  ...(scopes.length ? scopes : ["lib", "components", "app/api"])).split("\n"))]
  .filter(file => /\.(tsx?|mjs)$/.test(file) && fs.existsSync(path.join(root, file)));
const dirty = new Set(git("diff", "--name-only").split("\n"));
const groups = new Map();

for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)) && node.body && ts.isBlock(node.body)) {
      const body = node.body.getText(source);
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, body);
      const tokens = [];
      while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
      if (tokens.length >= 45) {
        const fingerprint = crypto.createHash("sha256").update(tokens.join(" ")).digest("hex");
        const item = {
          file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          name: node.name?.getText(source) || node.parent?.name?.getText(source) || "anonymous",
          lines: body.split("\n").length, dirty: dirty.has(file),
        };
        if (!groups.has(fingerprint)) groups.set(fingerprint, []);
        groups.get(fingerprint).push(item);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const duplicates = [...groups.values()]
  .filter(group => new Set(group.map(item => item.file)).size > 1)
  .sort((a, b) => b[0].lines * (b.length - 1) - a[0].lines * (a.length - 1));
console.log(JSON.stringify({ files: files.length, groups: duplicates.length, duplicates }, null, 2));
