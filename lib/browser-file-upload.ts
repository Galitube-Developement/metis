import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "@/lib/uploads";
import type { ElementHandle, FileChooser, Page } from "playwright";
import { completedUploadPath, getCompletedUpload } from "@/lib/file-upload-store";
import { MAX_ATTACHMENTS } from "@/lib/upload-limits";

const choosers = new WeakMap<Page, FileChooser>();
export function trackBrowserFileChooser(page: Page) {
  page.on("filechooser", chooser => choosers.set(page, chooser));
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) choosers.delete(page); });
}

export function browserUploadFiles(ownerId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_ATTACHMENTS
    || !ids.every(id => typeof id === "string") || new Set(ids).size !== ids.length) {
    throw new Error("Choose between 1 and 10 files.");
  }
  return ids.map(id => {
    const upload = getCompletedUpload(ownerId, id), source = completedUploadPath(ownerId, id);
    const name = sanitizeFileName(upload.name), safeName = /^\.+$/.test(name) ? "file" : name;
    const directory = path.join(path.dirname(source), "browser");
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, safeName);
    try { fs.linkSync(source, destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return { ...upload, path: destination };
  });
}

async function fileTargetAt(page: Page, x: number, y: number) {
  const pageX = x, pageY = y;
  let frame = page.mainFrame();
  for (let depth = 0; depth < 10; depth++) {
    const handle = await frame.evaluateHandle(({ x, y }) => {
      let element = document.elementFromPoint(x, y);
      while (element?.shadowRoot) {
        const nested = element.shadowRoot.elementFromPoint(x, y);
        if (!nested || nested === element) break;
        element = nested;
      }
      return element;
    }, { x, y });
    const element = handle.asElement() as ElementHandle<HTMLElement> | null;
    if (!element) { await handle.dispose(); throw new Error("Drop files onto an upload area on the page."); }
    const child = await element.contentFrame();
    if (!child) return { element, x, y, frame };
    const box = await element.boundingBox();
    // Bounding boxes are page-relative; frame hit testing uses its content viewport.
    const border = await element.evaluate(node => ({ x: node.clientLeft, y: node.clientTop }));
    await element.dispose();
    if (!box) throw new Error("The upload area is no longer visible.");
    x = pageX - box.x - border.x; y = pageY - box.y - border.y;
    frame = child;
  }
  throw new Error("The upload area could not be resolved.");
}

export async function uploadBrowserFiles(page: Page, ownerId: string, ids: unknown, point?: { x: number; y: number }) {
  const files = browserUploadFiles(ownerId, ids), paths = files.map(file => file.path);
  const chooser = choosers.get(page);
  if (chooser) {
    if (!chooser.isMultiple() && files.length > 1) throw new Error("This upload accepts one file at a time.");
    await chooser.setFiles(paths, { timeout: 15_000 });
    choosers.delete(page);
    return;
  }
  if (!point) {
    const inputs = page.frames().flatMap(frame => [frame.locator('input[type="file"]:not(:disabled)')]);
    const matches = await Promise.all(inputs.map(async input => ({ input, count: await input.count() })));
    if (matches.reduce((sum, match) => sum + match.count, 0) !== 1) {
      throw new Error("Click the page’s upload button first, or drop onto its upload area.");
    }
    const input = matches.find(match => match.count === 1)!.input;
    if (files.length > 1 && !await input.getAttribute("multiple").then(value => value !== null)) throw new Error("This upload accepts one file at a time.");
    await input.setInputFiles(paths, { timeout: 15_000 });
    return;
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Invalid browser drop position.");
  const target = await fileTargetAt(page, point.x, point.y);
  try {
    const inputHandle = await target.element.evaluateHandle(element => {
      if (element instanceof HTMLInputElement && element.type === "file") return element;
      const label = element.closest("label");
      if (label?.control instanceof HTMLInputElement && label.control.type === "file") return label.control;
      return element.querySelector('input[type="file"]');
    });
    const input = inputHandle.asElement() as ElementHandle<HTMLInputElement> | null;
    try {
      if (input) {
        if (files.length > 1 && !await input.evaluate(element => element.multiple)) throw new Error("This upload accepts one file at a time.");
        await input.setInputFiles(paths, { timeout: 15_000 });
        return;
      }
    } finally { await inputHandle.dispose(); }
    // Let Chromium create native File objects from paths, without base64-loading large files.
    const staging = await target.frame.evaluateHandle(() => {
      const input = document.createElement("input"); input.type = "file"; input.multiple = true; input.hidden = true;
      input.setAttribute("data-metis-upload-staging", ""); document.body.append(input); return input;
    });
    const stagingInput = staging.asElement() as ElementHandle<HTMLInputElement>;
    try {
      await stagingInput.setInputFiles(paths);
      const accepted = await target.element.evaluate((element, { input, x, y }) => {
        const transfer = new DataTransfer();
        for (const file of (input as HTMLInputElement).files || []) transfer.items.add(file);
        let accepted = false;
        for (const type of ["dragenter", "dragover", "drop", "dragleave"]) {
          const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y });
          element.dispatchEvent(event);
          if (type === "dragover" || type === "drop") accepted ||= event.defaultPrevented;
        }
        return accepted;
      }, { input: stagingInput, x: target.x, y: target.y });
      if (!accepted) throw new Error("This part of the page does not accept dropped files. Use its upload button.");
    } finally {
      await stagingInput.evaluate(input => input.remove()).catch(() => {});
      await staging.dispose();
    }
  } finally { await target.element.dispose(); }
}
