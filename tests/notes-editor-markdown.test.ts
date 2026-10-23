import test from "node:test";
import assert from "node:assert/strict";
import { parseNotesMarkdown, serializeNotesMarkdown, notesNodeSignature, type EditorNode } from "../lib/notes-editor-markdown";
import { getSchema } from "@tiptap/core";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";

const fence = String.fromCharCode(96).repeat(3);
const examples = [
  "", " \n\n", "# Heading\r\n\r\nA **bold** [link](https://example.com).\r\n",
  "Setext\n======\n\n* one\n  * child\n\n1. ordered\n2. next\n\n- [ ] task\n- [x] complete",
  "> Quote\n>\n> Second paragraph\n\n---\n\n![image](https://example.com/a.png \"Caption\")",
  "| A | B |\n| :--- | ---: |\n| **one** | two |\n\nInline $x^2$.\n\n$$\nx+y\n$$",
  fence + "typescript example\nconst x = " + String.fromCharCode(96) + "hi" + String.fromCharCode(96) + ";\n" + fence,
  "[reference][id]\n\n[id]: /target \"title\"\n\n<details><summary>raw</summary>unchanged</details>",
  ...["mermaid","chart","graph","file"].map((kind) => fence + kind + "\n{\"keep\":\"  exact  \"}\n" + fence + "\n"),
];
test("opening and saving CommonMark, GFM, math and unsupported Markdown is byte exact", () => {
  for (const source of examples) assert.equal(serializeNotesMarkdown(parseNotesMarkdown(source)), source);
});
test("editing one block keeps unrelated source fences and whitespace intact", () => {
  const source = "# Before\n\n" + fence + "mermaid\nA-->B\n" + fence + "\n\nTail\n";
  const doc = parseNotesMarkdown(source);
  doc.content![0].content![0].text = "After";
  assert.equal(serializeNotesMarkdown(doc), source.replace("# Before", "# After"));
});
test("lists, tables and inline marks survive a semantic edit and reparse", () => {
  const doc = parseNotesMarkdown("- [ ] task\n- [x] done\n\n| A | B |\n| --- | --- |\n| x | y |");
  doc.content![0].content![0].attrs!.checked = true;
  const output = serializeNotesMarkdown(doc);
  assert.match(output, /^- \[x\] task/);
  assert.equal(parseNotesMarkdown(output).content![0].content![0].attrs!.checked, true);
  assert.equal(parseNotesMarkdown(output).content![1].type, "table");
});
test("rich container envelopes and block identifiers preserve nested content", () => {
  const doc: EditorNode = { type: "doc", content: [{ type: "toggleBlock", attrs: { title: "Details", blockId: "stable_123" }, content: [{ type: "paragraph", content: [{type:"text",text:"Nested"}] }] }] };
  const markdown = serializeNotesMarkdown(doc);
  const parsed = parseNotesMarkdown(markdown);
  assert.equal(parsed.content![0].type, "toggleBlock");
  assert.equal(parsed.content![0].attrs!.blockId, "stable_123");
  assert.equal(parsed.content![0].content![0].content![0].text, "Nested");
  assert.equal(serializeNotesMarkdown(parsed), markdown);
});
test("raw malformed extension payload remains recoverable", () => {
  const source = fence + "metis-block\n{\"type\":\"unknown\"}\n" + fence;
  const doc = parseNotesMarkdown(source);
  assert.equal(doc.content![0].type, "sourceBlock");
  assert.equal(serializeNotesMarkdown(doc), source);
});

test("the actual ProseMirror schema preserves parsed Markdown and metadata", () => {
  const schema = getSchema(notesEditorExtensions());
  for (const source of examples) {
    const normalized = schema.nodeFromJSON(parseNotesMarkdown(source));
    normalized.check();
    assert.equal(serializeNotesMarkdown(normalized.toJSON()), source);
  }
});
test("colors and nested layouts round-trip through the actual schema", () => {
  const schema = getSchema(notesEditorExtensions());
  const input: EditorNode = {type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Color",marks:[{type:"textStyle",attrs:{color:"#ff0000"}},{type:"underline"}]}]},{type:"columns",content:[{type:"column",content:[{type:"paragraph",content:[{type:"text",text:"Left"}]}]},{type:"column",content:[{type:"paragraph",content:[{type:"text",text:"Right"}]}]}]}]};
  const markdown = serializeNotesMarkdown(input);
  const parsed = schema.nodeFromJSON(parseNotesMarkdown(markdown));
  parsed.check();
  assert.equal(parsed.child(0).child(0).marks.length, 2);
  assert.equal(parsed.child(1).type.name, "columns");
  assert.equal(serializeNotesMarkdown(parsed.toJSON()), markdown);
});

test("canonical rewrites preserve nested inline marks and Markdown punctuation", () => {
  const schema = getSchema(notesEditorExtensions());
  for (const source of ["A *bold **nested*** end.", "**a _b_** _c_", "A [**bold link**](note://page-1) and [issue](issue://issue-1).", "Escaped \\*asterisk\\* and \\[bracket\\].", "Code: ` a ` and ``x`y``.", "- one\n  - nested\n\n1. first\n2. second"]) {
    const original = schema.nodeFromJSON(parseNotesMarkdown(source));
    const doc = original.toJSON() as EditorNode;
    delete doc.attrs;
    for (const child of doc.content || []) if (child.attrs) delete child.attrs.sourceSignature;
    const output = serializeNotesMarkdown(doc);
    const reparsed = schema.nodeFromJSON(parseNotesMarkdown(output));
    assert.equal(notesNodeSignature(reparsed.toJSON()), notesNodeSignature(original.toJSON()), output);
  }
});
test("invalid container structure remains a raw source block", () => {
  const source = fence + 'metis-block\n{"type":"columns","content":[]}\n' + fence;
  const doc = parseNotesMarkdown(source);
  assert.equal(doc.content![0].type, "sourceBlock");
  assert.equal(serializeNotesMarkdown(doc), source);
});

test("resized and headerless tables retain attributes using a rich envelope", () => {
  const schema = getSchema(notesEditorExtensions());
  const doc = schema.nodeFromJSON(parseNotesMarkdown("| A | B |\n| --- | --- |\n| C | D |")).toJSON() as EditorNode;
  delete doc.attrs;
  const table = doc.content![0];
  delete table.attrs!.sourceSignature;
  table.content![0].content![0].attrs!.colwidth = [250];
  table.content![0].content![1].type = "tableCell";
  const markdown = serializeNotesMarkdown(doc);
  assert.match(markdown, /metis-block/);
  const parsed = schema.nodeFromJSON(parseNotesMarkdown(markdown));
  assert.deepEqual(parsed.child(0).child(0).child(0).attrs.colwidth, [250]);
  assert.equal(parsed.child(0).child(0).child(1).type.name, "tableCell");
});

test("explicit empty blocks and multiline headings survive reload without collapsing layout", () => {
  const schema = getSchema(notesEditorExtensions());
  const doc: EditorNode = {type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Before"}]},{type:"paragraph"},{type:"heading",attrs:{level:2},content:[{type:"text",text:"Two"},{type:"hardBreak"},{type:"text",text:"lines"}]},{type:"paragraph",content:[{type:"text",text:"After"}]}]};
  const parsed = schema.nodeFromJSON(parseNotesMarkdown(serializeNotesMarkdown(doc)));
  assert.equal(parsed.childCount,4);
  assert.equal(parsed.child(1).content.size,0);
  assert.equal(parsed.child(2).child(1).type.name,"hardBreak");
  assert.equal(serializeNotesMarkdown({type:"doc",content:[{type:"paragraph"}]}),"");
});

test("versioned table of contents remains a live block through the actual schema", () => {
  const schema = getSchema(notesEditorExtensions());
  const input: EditorNode = {type:"doc",content:[{type:"tableOfContents",attrs:{version:1}},{type:"heading",attrs:{level:2},content:[{type:"text",text:"Section"}]}]};
  const source = serializeNotesMarkdown(input);
  const parsed = schema.nodeFromJSON(parseNotesMarkdown(source));
  parsed.check();
  assert.equal(parsed.child(0).type.name,"tableOfContents");
  assert.equal(parsed.child(0).attrs.version,1);
  assert.equal(serializeNotesMarkdown(parsed.toJSON()),source);
  const future = source.replace('"version":1','"version":2');
  assert.equal(parseNotesMarkdown(future).content![0].type,"sourceBlock");
  assert.equal(serializeNotesMarkdown(parseNotesMarkdown(future)),future);
});
test("link titles and omitted rich defaults do not normalize untouched source", () => {
  const schema = getSchema(notesEditorExtensions());
  for (const source of ['[link](https://example.com "Keep title")\n\nTail',fence+'metis-block\n{"type":"toggleBlock","content":[{"type":"paragraph"}]}\n'+fence+'\n\nTail']) {
    const doc = schema.nodeFromJSON(parseNotesMarkdown(source)).toJSON() as EditorNode;
    assert.equal(serializeNotesMarkdown(doc),source);
    doc.content!.at(-1)!.content![0].text = "Changed tail";
    assert.equal(serializeNotesMarkdown(doc),source.replace(/Tail$/,"Changed tail"));
  }
});

test("leading YAML metadata is one opaque block through block and source mode round trips", () => {
  const schema = getSchema(notesEditorExtensions());
  const fixtures = [
    ["---\nname: example\ndescription: |\n  **literal Markdown**\n  --- nested scalar\nmetadata:\n  unknown: [one, {two: three}]\n---", "\n\n# Guide\n\nTail\n"],
    ["\uFEFF--- \t\r\nname: example\r\ndescription: \"Keep  two spaces\"\r\n---\t", "\r\n\r\nTail\r\n"],
    ["---\nname: example\n...\t", "\nTail"],
    ["---\n---", ""],
    ["---\nunknown: [invalid YAML\n---", "\n\nTail"],
    ["---\nname: example\n---", "\n\n" + fence + "mermaid\nA-->B\n" + fence + "\n\nTail"],
  ];
  for (const [header, body] of fixtures) {
    const source = header + body;
    let doc = schema.nodeFromJSON(parseNotesMarkdown(source)).toJSON() as EditorNode;
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(doc.content![0].type, "sourceBlock");
      assert.equal(doc.content![0].attrs!.label, "YAML frontmatter");
      assert.equal(doc.content![0].attrs!.source, header);
      assert.equal(serializeNotesMarkdown(doc), source);
      doc = schema.nodeFromJSON(parseNotesMarkdown(serializeNotesMarkdown(doc))).toJSON() as EditorNode;
    }
    if (body.includes("Tail")) {
      const tail = doc.content!.at(-1)!;
      assert.equal(tail.type, "paragraph");
      tail.content![0].text = "Changed tail";
      const saved = serializeNotesMarkdown(doc);
      assert.equal(saved, source.replace("Tail", "Changed tail"));
      assert.equal(parseNotesMarkdown(saved).content![0].attrs!.source, header);
      assert.ok(!saved.includes("metis-block"));
    }
  }
});

test("editing YAML metadata uses its raw source without a rich envelope", () => {
  const schema = getSchema(notesEditorExtensions());
  const source = "\uFEFF---\r\nname: original\r\ncustom: |\r\n  # stays YAML\r\n---\r\n\r\nBody";
  const doc = schema.nodeFromJSON(parseNotesMarkdown(source)).toJSON() as EditorNode;
  doc.content![0].attrs!.source = String(doc.content![0].attrs!.source).replace("name: original", "name: changed");
  const saved = serializeNotesMarkdown(doc);
  assert.equal(saved, source.replace("name: original", "name: changed"));
  assert.equal(schema.nodeFromJSON(parseNotesMarkdown(saved)).child(0).type.name, "sourceBlock");
  assert.ok(!saved.includes("metis-block"));
});

test("unclosed frontmatter stays recoverable and later separators stay Markdown", () => {
  const schema = getSchema(notesEditorExtensions());
  for (const source of ["---\nname: example\nmissing: [delimiter\n\n# Still part of the unfinished source", "\uFEFF---\r\nname: example\r\n", "---\n"]) {
    const doc = schema.nodeFromJSON(parseNotesMarkdown(source)).toJSON() as EditorNode;
    assert.equal(doc.content!.length, 1);
    assert.equal(doc.content![0].type, "sourceBlock");
    assert.equal(doc.content![0].attrs!.source, source);
    assert.equal(serializeNotesMarkdown(doc), source);
  }
  const ordinary = parseNotesMarkdown("# Heading\n\n---\n\nTail");
  assert.equal(ordinary.content![1].type, "horizontalRule");
  assert.equal(serializeNotesMarkdown(ordinary), "# Heading\n\n---\n\nTail");
  const code = parseNotesMarkdown(fence + "yaml\n---\nname: example\n---\n" + fence);
  assert.equal(code.content![0].type, "codeBlock");
});
