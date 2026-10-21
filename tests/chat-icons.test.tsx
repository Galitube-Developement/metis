import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownSpan } from "../components/markdown-span";
import { remarkChatIcons } from "../lib/markdown-icons";
import rehypeStreamingText from "../lib/rehype-streaming-text";
import { QUESTION_ICONS } from "../lib/mcp-core/question-schema.mjs";
import { METIS_CHAT_ICONS_PROMPT, METIS_SHARED_AGENT_CONTROL } from "../lib/agent-control";
Object.assign(globalThis, { React });

const render = (source: string, animate = false) => renderToStaticMarkup(
  <ReactMarkdown remarkPlugins={[remarkGfm, remarkChatIcons]}
    rehypePlugins={animate ? [[rehypeStreamingText, { from: 0, born: Date.now(), source }]] : []}
    components={{ span: MarkdownSpan }}>{source}</ReactMarkdown>
);

test("normal replies render icons in headings, paragraphs, lists and tables", () => {
  const html = render("## [icon:check] Bereit\n\n[icon:info] Ein Hinweis.\n\n- [icon:file] Bericht\n\n| Status | Ergebnis |\n| --- | --- |\n| [icon:search] Suche | Fertig |");
  assert.equal((html.match(/<svg /g) || []).length, 4);
  assert.match(html, /<h2><span class="metis-icon-line metis-icon-indent"><svg [\s\S]*?Bereit<\/span><\/h2>/);
  assert.match(html, /<li><span class="metis-icon-line metis-icon-indent"><svg [\s\S]*?Bericht<\/span><\/li>/);
  assert.match(html, /<td><span class="metis-icon-line metis-icon-indent"><svg [\s\S]*?Suche<\/span><\/td>/);
  assert.doesNotMatch(html, /\[icon:/);
  assert.equal((html.match(/aria-hidden="true"/g) || []).length, 4);
});

test("icon gutters stop at authored newlines, hard breaks and new paragraphs", () => {
  const html = render("[icon:check] First long line\nNext content\n[icon:info] Another line  \nLast content\n\nNormal paragraph");
  assert.equal((html.match(/metis-icon-indent/g) || []).length, 2);
  assert.match(html, /<span class="metis-icon-line">Next content<\/span>/);
  assert.match(html, /<span class="metis-icon-line">Last content<\/span>/);
  assert.match(html, /<p>Normal paragraph<\/p>/);
});

test("bold leading icons indent while inline icons and literal code do not", () => {
  const html = render("**[icon:check] Ready** with a [link](https://example.com)\n\nOrdinary [icon:info] prose\n\n`[icon:cpu]`");
  assert.equal((html.match(/metis-icon-indent/g) || []).length, 1);
  assert.match(html, /<strong><svg [\s\S]*?Ready<\/strong>/);
  assert.match(html, /<p>Ordinary <svg /);
  assert.match(html, /<code>\[icon:cpu\]<\/code>/);
  const formatted = render("**[icon:check] First\nSecond**");
  assert.match(formatted, /<span class="metis-icon-line"><strong>Second<\/strong><\/span>/);
});

test("image paragraphs retain their direct embed children", () => {
  const html = render("[icon:file] Attachment ![Image](/api/files/image.png)");
  assert.doesNotMatch(html, /metis-icon-indent/);
  assert.match(html, /Attachment <img /);
});

test("all supported form and chat icon names produce real SVGs", () => {
  const html = render(QUESTION_ICONS.map(name => `[icon:${name}] ${name}`).join("\n\n"));
  assert.equal((html.match(/<svg /g) || []).length, QUESTION_ICONS.length);
});

test("code, unknown names, URLs and incomplete streamed tokens remain literal", () => {
  const html = render("\`[icon:cpu]\`\n\n~~~text\n[icon:settings]\n~~~\n\n[icon:unknown] [icon:sear\n\n[Docs](https://example.com/[icon:file])");
  assert.equal((html.match(/<svg /g) || []).length, 0);
  assert.match(html, /<code>\[icon:cpu\]<\/code>/);
  assert.match(html, /\[icon:settings\]/);
  assert.match(html, /\[icon:unknown\]/);
  assert.match(html, /\[icon:sear/);
  assert.equal(decodeURI(html.match(/href="([^"]+)"/)![1]), "https://example.com/[icon:file]");
  assert.equal((render("[icon:search] Vollständig").match(/<svg /g) || []).length, 1);
});

test("stream animation and icon rendering coexist without empty placeholder spans", () => {
  const html = render("[icon:search] Quellen prüfen und **[icon:check] fertig**", true);
  assert.equal((html.match(/<svg /g) || []).length, 2);
  assert.match(html, /stream-token-fade/);
  assert.match(html.replace(/<[^>]*>/g, "").replace(/\s+/g, " "), /Quellen prüfen und fertig/);
  assert.doesNotMatch(html, /data-metis-icon|\[icon:/);
  assert.match(renderToStaticMarkup(<MarkdownSpan className="unchanged">Ordinary span</MarkdownSpan>), /<span class="unchanged">Ordinary span<\/span>/);
});

test("shared provider contract includes normal-chat icons with valid examples", () => {
  assert.ok(METIS_SHARED_AGENT_CONTROL.includes(METIS_CHAT_ICONS_PROMPT));
  const examples = [...METIS_CHAT_ICONS_PROMPT.matchAll(/\[icon:([a-z-]+)\]/g)]
    .map(match => match[1]).filter(name => name !== "name");
  assert.ok(examples.length >= 3);
  for (const name of examples) assert.ok(QUESTION_ICONS.includes(name));
  for (const name of QUESTION_ICONS) assert.ok(METIS_CHAT_ICONS_PROMPT.includes(name));
});
