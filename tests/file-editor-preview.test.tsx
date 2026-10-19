import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileEditorPreview } from "../components/file-editor-preview";
import { filePreviewKind, htmlPreviewDocument, isBinaryFilePreview, markdownPreviewAssetUrl, workspacePreviewUrl } from "../lib/file-editor-preview";
Object.assign(globalThis,{React});

test("preview kinds distinguish editable documents from streamed media",()=>{
  for(const [name,kind] of [["demo.MP4","video"],["sound.ogg","audio"],["image.webp","image"],["file.pdf","pdf"],["README.md","markdown"],["page.HTM","html"],["drawing.svg","svg"]] as const) assert.equal(filePreviewKind(name),kind);
  assert.equal(filePreviewKind("source.ts"),null);
  assert.equal(filePreviewKind("archive.zip"),null);
  assert.equal(isBinaryFilePreview("video"),true);
  assert.equal(isBinaryFilePreview("markdown"),false);
  assert.equal(workspacePreviewUrl("/workspace/100% #? movie.mp4"),"/api/remote/preview?path=%2Fworkspace%2F100%25%20%23%3F%20movie.mp4");
});
test("Markdown renders headings, tables and relative images without executing markup",()=>{
  const html=renderToStaticMarkup(<FileEditorPreview path="/workspace/docs/readme.md" kind="markdown" content={'# Read me\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n![Local](../image%20one.png)\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'}/>);
  assert.match(html,/<h1>Read me<\/h1>/);assert.match(html,/<table>/);
  assert.match(html,/path=%2Fworkspace%2Fimage%20one.png/);
  assert.doesNotMatch(html,/<script>|href="javascript:/);
  assert.equal(markdownPreviewAssetUrl("../../image.png","/workspace/docs/sub/readme.md"),"/api/remote/preview?path=%2Fworkspace%2Fimage.png");
  assert.equal(markdownPreviewAssetUrl("https://example.com/image.png","/workspace/readme.md"),"https://example.com/image.png");
});
test("HTML uses an isolated frame with no parent access or authenticated connections",()=>{
  const source="<h1>Example</h1><script>document.body.dataset.ran='yes'</script>";
  const html=renderToStaticMarkup(<FileEditorPreview path="/workspace/page.html" kind="html" content={source}/>);
  assert.match(html,/sandbox="allow-scripts"/);assert.doesNotMatch(html,/allow-same-origin|allow-top-navigation|allow-forms/);
  assert.match(html,/srcDoc=/i);
  const doc=htmlPreviewDocument(source);
  assert.ok(doc.indexOf("Content-Security-Policy")<doc.indexOf(source));
  assert.match(doc,/connect-src 'none'/);assert.match(doc,/form-action 'none'/);
  assert.ok(doc.includes(source));
});
test("media previews expose native playback and seeking sources",()=>{
  for(const kind of ["video","audio","pdf"] as const){
    const html=renderToStaticMarkup(<FileEditorPreview path={"/workspace/example."+kind} kind={kind} content=""/>);
    assert.match(html,/\/api\/remote\/preview\?path=/);
    if(kind!=="pdf"){assert.match(html,/controls=""/);assert.match(html,/preload="metadata"/);}
  }
});
