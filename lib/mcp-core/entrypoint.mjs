import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// File URLs and drive-letter paths are different representations on Windows.
// Resolve aliases (including 8.3 paths) before deciding whether to start a CLI.
export function isDirectExecution(moduleUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  try {
    return realpathSync.native(argvPath) === realpathSync.native(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
