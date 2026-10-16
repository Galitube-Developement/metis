import { chromium } from "playwright";
import { documentExportHtml } from "@/lib/document-export";

let activeExports = 0;
export class ExportBusyError extends Error {}

/** Dedicated ephemeral browser, never the user's persistent browser or its cookies. */
export async function documentExportPdf(name: string, content: string, signal?: AbortSignal) {
  if (activeExports >= 2) throw new ExportBusyError("PDF export is busy. Please try again.");
  activeExports++;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { void browser?.close().catch(() => {}); };
  try {
    const html = await documentExportHtml(name, content);
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: true, timeout: 30_000 });
    signal?.throwIfAborted();
    signal?.addEventListener("abort", close, { once: true });
    timer = setTimeout(close, 30_000);
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block", offline: true });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    return await page.pdf({
      format: "A4", printBackground: true, displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "18mm", right: "18mm", bottom: "20mm", left: "18mm" },
    });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", close);
    await browser?.close().catch(() => {});
    activeExports--;
  }
}
