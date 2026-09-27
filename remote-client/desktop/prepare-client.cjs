/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
fs.mkdirSync(path.join(__dirname, "assets"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "client.mjs"), path.join(__dirname, "client.mjs"));
fs.copyFileSync(path.join(__dirname, "..", "computer-use.mjs"), path.join(__dirname, "computer-use.mjs"));
fs.copyFileSync(path.join(__dirname, "..", "computer-use-worker.mjs"), path.join(__dirname, "computer-use-worker.mjs"));
