import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectNotesMarkdownHeadings } from "../lib/notes-editor-headings";
import { NotesRichBlockPreview } from "../components/notes/rich-block-preview";
Object.assign(globalThis, { React });

test("rich Markdown preview renders nested containers and formatting as safe React content", () => {
  const source = JSON.stringify({type:"toggleBlock",attrs:{title:"Details",open:true},content:[{type:"columns",content:[{type:"column",content:[{type:"paragraph",content:[{type:"text",text:"Left",marks:[{type:"bold"}]}]}]},{type:"column",content:[{type:"paragraph",content:[{type:"text",text:"Right",marks:[{type:"textStyle",attrs:{color:"#ff0000"}},{type:"underline"}]}]}]}]}]});
  const html = renderToStaticMarkup(<NotesRichBlockPreview source={source}/>);
  assert.match(html, /<details open/);
  assert.match(html, /<summary[^>]*>Details/);
  assert.match(html, /<strong>Left<\/strong>/);
  assert.match(html, /color:#ff0000/);
  assert.match(html, /<u>/);
  assert.doesNotMatch(html, /metis-block/);
});
test("unsafe destinations and raw HTML remain inert in rich previews", () => {
  const source = JSON.stringify({type:"callout",content:[{type:"paragraph",content:[{type:"text",text:"<script>bad()</script>",marks:[{type:"link",attrs:{href:"javascript:alert(1)"}}]},{type:"image",attrs:{src:"javascript:alert(2)",alt:"Blocked"}}]}]});
  const html = renderToStaticMarkup(<NotesRichBlockPreview source={source}/>);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:|<script|<img/);
});
test("malformed rich blocks keep their complete source visible", () => {
  const source = '{"type":"unsupported","value":"recover me"}';
  const html = renderToStaticMarkup(<NotesRichBlockPreview source={source}/>);
  assert.match(html, /could not be read/);
  assert.match(html, /recover me/);
});

test("table of contents derives safe live heading labels and matching rich anchors", () => {
  const tick = String.fromCharCode(96).repeat(3);
  const rich = JSON.stringify({type:"callout",content:[{type:"heading",attrs:{level:3},content:[{type:"text",text:"Nested heading"}]}]});
  const source = '# First\n\n## <script>alert(1)</script>\n\n'+tick+'metis-block\n'+rich+'\n'+tick;
  const headings = collectNotesMarkdownHeadings(source);
  assert.deepEqual(headings.map((heading) => heading.level),[1,2,3]);
  const html = renderToStaticMarkup(<NotesRichBlockPreview source={JSON.stringify({type:"tableOfContents",attrs:{version:1}})} headings={headings}/>);
  assert.match(html,/aria-label="Table of contents"/);
  assert.match(html,/href="#notes-heading-/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script/);
  const richHtml = renderToStaticMarkup(<NotesRichBlockPreview source={rich} headings={headings} sourceOffset={headings[2].sourceOffset}/>);
  assert.ok(richHtml.includes('id="'+headings[2].id+'"'));
  assert.equal(collectNotesMarkdownHeadings(source.replace('# First','# Renamed'))[0].title,'Renamed');
});
