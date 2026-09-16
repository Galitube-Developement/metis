type NumberedLine = {
  lineNumber: number;
  content: string;
};

function parseNumberedLine(line: string): NumberedLine | null {
  const match =
    line.match(/^ *(\d+)\t(.*)$/) ||
    line.match(/^ *(\d+)\|(.*)$/) ||
    line.match(/^L(\d+):(.*)$/) ||
    line.match(/^ *(\d+) (.*)$/);
  if (!match) return null;
  return { lineNumber: Number(match[1]), content: match[2] };
}

export function stripReadFileLinePrefixes(raw: string, startLine = 1): string {
  const trailingNewline = raw.endsWith("\n");
  const lines = raw.split(/\r?\n/);
  if (trailingNewline) lines.pop();

  const parsed = lines.map(parseNumberedLine);
  const isSequential = parsed.every(
    (line, index) => line?.lineNumber === startLine + index,
  );
  if (!isSequential) return raw;

  const content = parsed.map((line) => line!.content).join("\n");
  return trailingNewline ? `${content}\n` : content;
}
