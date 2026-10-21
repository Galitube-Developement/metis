import type { IncomingAttachment } from "@/lib/uploads";

/** The report tool accepts text, never a caller-selected filesystem path or MIME type. */
export function researchReportAttachment(input: unknown): IncomingAttachment {
  const report = input as { title?: unknown; content?: unknown } | null;
  if (!report || typeof report.title !== "string" || !report.title.trim() || report.title.length > 200 ||
      typeof report.content !== "string" || !report.content.trim() || Buffer.byteLength(report.content, "utf8") > 500_000) {
    throw new Error("A report title and nonempty content up to 500000 bytes are required.");
  }
  const title = report.title.trim();
  const stem = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 100) || "Research report";
  return { name: stem + ".md", mimeType: "text/markdown",
    data: Buffer.from("# " + title.replace(/[\r\n]/g, " ") + "\n\n" + report.content, "utf8").toString("base64") };
}
