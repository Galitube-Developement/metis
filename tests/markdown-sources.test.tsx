import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownSpan } from "../components/markdown-span";
import { markdownSourceTitle } from "../lib/markdown-source-title";
import rehypeStreamingText from "../lib/rehype-streaming-text";
Object.assign(globalThis, { React });

function render(source: string, animate = false) {
  return renderToStaticMarkup(<ReactMarkdown rehypePlugins={animate ? [[rehypeStreamingText, { from: 0, born: Date.now(), source }]] : []}
    components={{ span: MarkdownSpan, a: ({ children, ...props }) => {
      const title = markdownSourceTitle(children);
      return <a {...props} data-source-badge={title ? "true" : undefined}>{title ?? children}</a>;
    } }}>{source}</ReactMarkdown>);
}

test("source links retain badge identity when streaming wraps their label in spans", () => {
  for (const animate of [false, true]) {
    const html = render("Aussage. [Source: OMNI-25](https://example.com/issue/OMNI-25)", animate);
    assert.match(html, /data-source-badge="true">OMNI-25<\/a>/);
    assert.match(html, /href="https:\/\/example.com\/issue\/OMNI-25"/);
    assert.doesNotMatch(html, />Source:/);
  }
});

test("German and English labels survive nested formatting and split text nodes", () => {
  for (const label of ["Quelle: **Dokument**", "source - *Website*", "**Source:** `API`"]) {
    const html = render(`[${label}](https://example.com)`, true);
    assert.match(html, /data-source-badge="true"/);
  }
  assert.equal(markdownSourceTitle(<><span>Sou</span><strong>rce: </strong><span>OMNI-42</span></>), "OMNI-42");
});

test("ordinary links, file labels and incomplete source labels stay ordinary", () => {
  for (const label of ["Documentation", "Source:", "Source", "A Source: Example", "Quelle", "resource: API"]) {
    assert.doesNotMatch(render(`[${label}](https://example.com)`, true), /data-source-badge/);
  }
  assert.equal(markdownSourceTitle(null), null);
  assert.equal(markdownSourceTitle(["Source: ", false, 42]), "42");
});

test("a completed streamed citation renders a badge without interpreting code examples", () => {
  assert.doesNotMatch(render("[Source: OMNI-25](https://example.com", true), /data-source-badge/);
  assert.match(render("[Source: OMNI-25](https://example.com)", true), /data-source-badge="true"/);
  assert.doesNotMatch(render("`[Source: OMNI-25](https://example.com)`", true), /data-source-badge/);
});

test("text inspection does not execute arbitrary React components", () => {
  function Opaque(): React.ReactNode { throw new Error("Must not be executed"); }
  assert.equal(markdownSourceTitle(<Opaque />), null);
});
