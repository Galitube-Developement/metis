export function normalizeContextText(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}._/-]+/gu, " ")
    .trim();
}
