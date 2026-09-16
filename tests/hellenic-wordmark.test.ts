import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

test("sidebar brand uses the Hellenic GFS Didot wordmark", () => {
  const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(shell, /lang="grc"/);
  assert.match(shell, /className="metis-wordmark relative z-20 text-foreground\/90">Μῆτις<\/span>/);
  assert.match(layout, /GFS_Didot/);
  assert.match(layout, /variable: "--font-wordmark"/);
  assert.match(css, /\.metis-wordmark \{/);
  assert.match(css, /font-family: var\(--font-wordmark\)/);
  assert.match(css, /font-style: italic/);
});
