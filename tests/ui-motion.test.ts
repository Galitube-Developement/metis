import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeStreamingText from "../lib/rehype-streaming-text";
import { appendStreamingText, initialStreamingText, STREAM_FADE_MS } from "../lib/streaming-text";
import { StreamingSpan } from "../components/streaming-text";
import { AnimatedNumber } from "../components/animated-number";
import { ChartBoundary } from "../components/chart-boundary";

// tsx follows this repository's preserved JSX configuration.
Object.assign(globalThis, { React });
const visible = (state: ReturnType<typeof initialStreamingText>) => state.prefix + state.segments.map(segment => segment.text).join("");

test("appending streamed text keeps earlier keys and fades only the new tail", () => {
  const first = initialStreamingText("Hello", 0);
  const next = appendStreamingText(first, "Hello world", 64);
  assert.equal(next.segments[0].id, first.segments[0].id);
  assert.deepEqual(next.segments.slice(0, first.segments.length), first.segments);
  assert.equal(next.segments.slice(first.segments.length).map(segment => segment.text).join(""), " world");
  assert.equal(visible(next), "Hello world");
  assert.equal(appendStreamingText(next, next.text, 1000), next);
});
test("expired streaming fragments collapse to a bounded stable prefix", () => {
  let state = initialStreamingText("", 0);
  for (let index = 0; index < 500; index++) {
    state = appendStreamingText(state, state.text + "x", index * 64);
    assert.ok(state.segments.length <= Math.ceil(STREAM_FADE_MS / 64) + 1);
  }
  assert.equal(visible(state), "x".repeat(500));
  assert.ok(state.text.length - state.prefix.length <= Math.ceil(STREAM_FADE_MS / 64));
});
test("rewrites and deletions never replay the whole message animation", () => {
  const first = initialStreamingText("Hello old text", 0);
  for (const replacement of ["Hello new text", "Hello", ""]) {
    const state = appendStreamingText(first, replacement, 64);
    assert.equal(visible(state), replacement);
    assert.equal(state.segments.length, 0);
  }
});
test("streamed Unicode remains intact across surrogate, combining and emoji boundaries", () => {
  for (const [before, after] of [["Hi ", "Hi 😀"], ["cafe", "café"], ["👩", "👩‍💻"], ["🇩", "🇩🇪"]]) {
    const first = initialStreamingText(before, 0);
    const state = appendStreamingText(first, after, 64);
    assert.equal(visible(state), after);
    assert.ok(!state.segments.some(segment => /^[\uDC00-\uDFFF]/.test(segment.text)));
  }
  const incomplete = initialStreamingText("Hi \uD83D", 0);
  assert.equal(visible(incomplete), "Hi ");
  assert.equal(visible(appendStreamingText(incomplete, "Hi 😀", 64)), "Hi 😀");
});
test("streaming prose fades while Markdown tables, links, code and math stay valid", () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [[rehypeKatex, { throwOnError: false }], rehypeStreamingText],
    components: { span: StreamingSpan },
    children: "Hello **world** [link](https://example.com).\n\n| A | B |\n| - | - |\n| One | Two |\n\n\`inline\` and $x^2$.\n\n\`\`\`js\nconst value = 1;\n\`\`\`",
  }));
  assert.match(html, /stream-token-fade/);
  assert.match(html.replace(/<\/?span\b[^>]*>/g, ""), /<strong>world<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com"><span class="stream-token-fade">link/);
  assert.match(html, /<table>/);
  assert.match(html, /<code>inline<\/code>/);
  assert.match(html, /<pre><code class="language-js">const value = 1;/);
  assert.doesNotMatch(html, /<code[^>]*><span class="stream-token-fade"/);
  assert.doesNotMatch(html, /class="katex[^"]*"[^>]*><span class="stream-token-fade"/);
});
test("tickers expose exact accessible values, preserving missing reports and zero", () => {
  const html = (value: number | null, format?: "money") => renderToStaticMarkup(React.createElement(AnimatedNumber, { value, format }));
  assert.equal(html(null), "<span>—</span>");
  assert.equal(html(NaN), "<span>—</span>");
  assert.match(html(0), /class="sr-only">0<\/span>/);
  assert.match(html(123456), /class="sr-only">123,456<\/span>/);
  assert.match(html(4.125, "money"), /class="sr-only">\$4.125<\/span>/);
  assert.match(html(123), /aria-hidden="true"/);
});
test("chart failure stays local, recovers on a new selection, and logs the stack", async () => {
  assert.deepEqual(ChartBoundary.getDerivedStateFromError(), { failed: true });
  assert.equal(ChartBoundary.getDerivedStateFromProps({ children: null, resetKey: "a" }, { failed: true, attempt: 0, resetKey: "a" }), null);
  assert.deepEqual(ChartBoundary.getDerivedStateFromProps({ children: null, resetKey: "b" }, { failed: true, attempt: 0, resetKey: "a" }), { failed: false, attempt: 0, resetKey: "b" });
  const original = globalThis.fetch;
  let submitted: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, options) => { submitted = JSON.parse(String(options?.body)); return new Response("{}"); };
  try {
    const boundary = new ChartBoundary({ children: null, label: "usage-overview" });
    boundary.componentDidCatch(new Error("plot failure"), { componentStack: "ChartPlot" });
    assert.ok(submitted);
    const entry = (submitted.entries as Array<Record<string, unknown>>)[0];
    assert.equal(entry.source, "frontend");
    assert.match(String(entry.stack), /plot failure/);
    assert.deepEqual(entry.context, { chart: "usage-overview", componentStack: "ChartPlot" });
    boundary.state.failed = true;
    const html = renderToStaticMarkup(boundary.render());
    assert.match(html, /Retry chart/);
    assert.match(html, /role="alert"/);
  } finally { globalThis.fetch = original; }
});

test("motion ends naturally and reduced motion disables tickers, fades and distributions", () => {
  const css=postcss.parse(readFileSync(new URL("../app/globals.css",import.meta.url),"utf8"));
  const overrides=new Map<string,string>();
  css.walkAtRules("media",media=>{
    if(media.params!=="(prefers-reduced-motion: reduce)")return;
    media.walkRules(rule=>rule.walkDecls(declaration=>{
      for(const selector of rule.selector.split(","))overrides.set(selector.trim()+":"+declaration.prop,declaration.value);
    }));
  });
  assert.equal(overrides.get(".number-ticker-wheel:transition"),"none");
  assert.equal(overrides.get(".stream-token-fade:animation"),"none");
  assert.equal(overrides.get(".usage-distribution-fill:animation"),"none");
  css.walkRules(rule=>{
    if([".number-ticker-wheel",".stream-token-fade",".usage-distribution-fill"].includes(rule.selector))rule.walkDecls("animation",declaration=>assert.doesNotMatch(declaration.value,/infinite/));
  });
});
