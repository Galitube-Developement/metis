export type FileEntry = { name: string; directory: boolean; path: string };

export function parseFileListing(output: string, cwd: string): FileEntry[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([d-])[^\s]*\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/);
    if (!match || match[2] === "." || match[2] === "..") return [];
    const name = match[2];
    return [{ name, directory: match[1] === "d", path: `${cwd.replace(/\/$/, "")}/${name}` }];
  }).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export function fileEntryNameError(name: string): string {
  if (!name.trim()) return "Enter a name.";
  if (name === "." || name === ".." || /[/\\\x00-\x1f]/.test(name)) return "Use a name without slashes or control characters.";
  if (new TextEncoder().encode(name).length > 255) return "This name is too long.";
  return "";
}

export function parentFileDirectory(path: string): string {
  return path.replace(/\/+$/, "").slice(0, path.replace(/\/+$/, "").lastIndexOf("/")) || "/";
}
