/** File identity, rather than Markdown-looking prose, selects the shared Markdown editor. */
export function isMarkdownFile(path: string, mimeType = ""): boolean {
  const mime = mimeType.split(";", 1)[0].trim().toLowerCase();
  return mime === "text/markdown" || /\.(?:md|markdown)$/i.test(path.split(/[?#]/, 1)[0]);
}
