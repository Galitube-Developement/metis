import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { iconNames } from "lucide-react/dynamic.mjs";

const require = createRequire(import.meta.url);
const version = JSON.parse(readFileSync(require.resolve("lucide-react/package.json"), "utf8")).version;
const target = fileURLToPath(new URL("../lib/project-icon-names.ts", import.meta.url));
const names = [...iconNames].sort();
const source = `// Generated from lucide-react ${version}. Regenerate with node scripts/generate-project-icons.mjs.\nexport const PROJECT_ICON_NAMES: readonly string[] = ${JSON.stringify(names, null, 2)};\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== source) throw new Error("Project icon catalog is outdated. Run node scripts/generate-project-icons.mjs.");
} else writeFileSync(target, source);
console.log(`PROJECT_ICON_CATALOG_OK ${names.length} icons`);
