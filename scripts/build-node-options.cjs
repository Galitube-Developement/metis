/* eslint-disable @typescript-eslint/no-require-imports -- This CommonJS helper runs before the TypeScript runtime is available. */
const os = require("node:os");

// Leave room for the OS, the running installation and Next's native allocations.
// Node's constrainedMemory accounts for container/cgroup limits where available.
function buildHeapMb(totalBytes, constrainedBytes = 0) {
  const capacities = [totalBytes, constrainedBytes].filter((value) => Number.isFinite(value) && value > 0);
  const capacityMb = Math.floor(Math.min(...capacities) / (1024 * 1024));
  if (!Number.isFinite(capacityMb)) return 4096;
  return Math.max(256, Math.min(8192, Math.floor(capacityMb * 0.75)));
}

function buildNodeOptions(existing, totalBytes, constrainedBytes = 0) {
  const options = existing || "";
  // Explicit user limits (including underscore spellings) remain authoritative.
  if (/(?:^|\s|")--max[-_]old[-_]space[-_]size(?:[-_]percentage)?(?:=|\s)/.test(options)) return options;
  return [options, `--max-old-space-size=${buildHeapMb(totalBytes, constrainedBytes)}`].filter(Boolean).join(" ");
}

module.exports = { buildHeapMb, buildNodeOptions };
if (require.main === module) {
  process.stdout.write(buildNodeOptions(
    process.env.NODE_OPTIONS,
    os.totalmem(),
    typeof process.constrainedMemory === "function" ? process.constrainedMemory() : 0,
  ));
}
