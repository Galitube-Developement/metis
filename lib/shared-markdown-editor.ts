import { Extension, mergeAttributes } from "@tiptap/core";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createNotesMarkdownSerializer } from "./notes-editor-markdown";

/** Resolve file-relative assets only at render time; persisted Markdown keeps its portable URLs. */
export function markdownDisplayImageExtension(resolveUrl: (url: string) => string, options?: Partial<ImageOptions>) {
  return Image.extend({
    renderHTML({ HTMLAttributes }) {
      return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: resolveUrl(String(HTMLAttributes.src || "")) })];
    },
  }).configure(options);
}

/** Existing oversized documents remain editable: only reductions are allowed until below the limit. */
export function markdownChangeFitsLimit(previous: string, next: string, maxLength: number) {
  return markdownLengthChangeFitsLimit(previous.length, next.length, maxLength);
}

export function markdownLengthChangeFitsLimit(previous: number, next: number, maxLength: number) {
  return next <= maxLength || next < previous;
}

export function markdownEditorGuard(options: {
  maxLength: () => number;
  disabled: () => boolean;
  externalUpdate: () => boolean;
  onExceeded: () => void;
  serialize?: (doc: ProseMirrorNode) => string;
}) {
  const serialize = options.serialize || createNotesMarkdownSerializer();
  return Extension.create({
    name: "sharedMarkdownGuard",
    addProseMirrorPlugins() {
      return [new Plugin({
        filterTransaction(transaction, state) {
          if (!transaction.docChanged || options.externalUpdate()) return true;
          if (options.disabled()) return false;
          const previous = serialize(state.doc);
          const next = serialize(transaction.doc);
          if (markdownChangeFitsLimit(previous, next, options.maxLength())) return true;
          options.onExceeded();
          return false;
        },
      })];
    },
  });
}
