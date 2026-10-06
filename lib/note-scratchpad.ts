export type NoteAttachmentLink = { name: string; kind: string; url: string };

export function noteAttachmentMarkdown(attachments: NoteAttachmentLink[]) {
  return attachments.map((attachment) => {
    const label = attachment.name.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/[\r\n]/g, " ");
    return `${attachment.kind === "image" ? "!" : ""}[${label}](${attachment.url})`;
  }).join("\n\n");
}
