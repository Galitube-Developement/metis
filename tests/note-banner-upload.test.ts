import assert from "node:assert/strict";
import test from "node:test";
import { uploadNoteBanner } from "../lib/note-banner-upload";
import { MAX_INLINE_IMAGE_BYTES } from "../lib/upload-limits";
import { commitNoteDraft } from "../lib/note-save-state";
import type { SharedNote } from "../lib/store";

const noteId = "note/test";
const url = "/api/notes/note%2Ftest/attachments/00000000-0000-4000-8000-000000000001";
test("an uploaded banner rebases over a simultaneous text edit without replacing the icon or content", async () => {
  const base = { id: "note", content: "Original", icon: null, cover: null, version: 1 } as SharedNote;
  const remote = { ...base, content: "Remote edit", icon: "📚", version: 2 };
  let calls = 0;
  const saved = await commitNoteDraft(base, { cover: url }, async (patch, version) => {
    calls++;
    if (calls === 1) return { status: 409, note: remote };
    assert.equal(version, 2);
    assert.deepEqual(patch, { cover: url });
    return { status: 200, note: { ...remote, ...patch, version: 3 } };
  });
  assert.equal(calls, 2);
  assert.equal(saved.note.content, "Remote edit");
  assert.equal(saved.note.icon, "📚");
  assert.equal(saved.note.cover, url);
});

test("simultaneous changes to icons and banners stop at a conflict instead of overwriting", async () => {
  const base = { id: "note", icon: null, cover: null, version: 1 } as SharedNote;
  let calls = 0;
  const result = await commitNoteDraft(base, { icon: "💡", cover: url }, async () => {
    calls++;
    return { status: 409, note: { ...base, icon: "📚", cover: "other-banner", version: 2 } };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.conflicts.map(conflict => conflict.field), ["icon", "cover"]);
});

const file = () => new File(["image fixture"], "banner.png", { type: "image/png" });
const uploaded = () => Response.json({ attachments: [{ url, mimeType: "image/png" }] });

test("banner uploads use the note attachment endpoint and retain the file and abort signal", async () => {
  const controller = new AbortController();
  const selected = file();
  let calls = 0;
  const result = await uploadNoteBanner(noteId, selected, controller.signal, async (input, init) => {
    calls++;
    assert.equal(input, "/api/notes/note%2Ftest/attachments");
    assert.equal(init?.method, "POST");
    assert.equal(init?.signal, controller.signal);
    assert.ok(init?.body instanceof FormData);
    const entries = [...init.body.entries()];
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], "files");
    const sent = entries[0][1] as File;
    assert.equal(sent.name, selected.name);
    assert.equal(await sent.text(), await selected.text());
    return uploaded();
  });
  assert.equal(calls, 1);
  assert.equal(result, url);
});

test("unsupported, empty and oversized banners never start a request", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return uploaded(); };
  for (const candidate of [
    new File(["plain text"], "document.txt", { type: "text/plain" }),
    new File(["<svg/>"], "banner.svg", { type: "image/svg+xml" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }),
  ]) await assert.rejects(uploadNoteBanner(noteId, candidate, undefined, request));
  assert.equal(calls, 0);
});

test("upload failures preserve the server's actionable error and permit an independent retry", async () => {
  await assert.rejects(uploadNoteBanner(noteId, file(), undefined, async () => Response.json({ error: "Your attachment limit is exceeded." }, { status: 400 })), /attachment limit/);
  await assert.rejects(uploadNoteBanner(noteId, file(), undefined, async () => new Response("Unavailable", { status: 503 })), /Could not upload/);
  assert.equal(await uploadNoteBanner(noteId, file(), undefined, async () => uploaded()), url);
});

test("incomplete and unrelated attachment responses cannot become a banner", async () => {
  for (const attachment of [
    undefined,
    { url: "https://other.example/image.png", mimeType: "image/png" },
    { url: url.replace("note%2Ftest", "other-note"), mimeType: "image/png" },
    { url: url + "/../file", mimeType: "image/png" },
    { url, mimeType: "application/octet-stream" },
  ]) await assert.rejects(uploadNoteBanner(noteId, file(), undefined, async () => Response.json({ attachments: attachment ? [attachment] : [] })), /invalid image/);
});
