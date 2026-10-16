import assert from "node:assert/strict";
import test from "node:test";
import { documentExportHtml, documentExportName, markdownPlainText } from "../lib/document-export";
import { documentExportPdf } from "../lib/document-export-pdf";

test("export names keep Unicode and remove path separators and header controls", () => {
  assert.equal(documentExportName('Größe / Entwurf.pdf', "txt"), "Größe - Entwurf.txt");
  assert.equal(documentExportName('..', "pdf"), "document.pdf");
  assert.doesNotMatch(documentExportName('a\r\n"\\/b', "md"), /[\r\n"\\/]/);
});

test("plain text keeps tasks, ordered/nested lists, code, tables, links and Unicode", () => {
  const source = "# Größe\n\n**Hallo** und _Welt_\n\n- [x] Erledigt\n- [ ] Offen\n  - Unterpunkt\n\n3. Dritter\n4. Vierter\n\n\`\`\`ts\nconst ü = 1;\n\`\`\`\n\n| Name | Wert |\n| --- | --- |\n| Öl | 42 |\n\n[Quelle](https://example.com)";
  const txt = markdownPlainText(source);
  assert.ok(txt.startsWith("Größe\n\nHallo und Welt"));
  for (const part of ["[x] Erledigt", "[ ] Offen", "Unterpunkt", "3. Dritter", "4. Vierter", "const ü = 1;", "Name | Wert", "Öl | 42", "Quelle (https://example.com)"]) assert.ok(txt.includes(part), part);
  assert.doesNotMatch(txt, /\*\*Hallo|\`\`\`|\| ---/);
  assert.equal(markdownPlainText(""), "");
});

test("PDF HTML drops executable HTML, unsafe URLs and image fetches while keeping structure", async () => {
  const html = await documentExportHtml('<img src=x onerror=alert(1)>', "# Heading\n\n<script>alert(1)</script>\n\n![Bild](http://127.0.0.1/private)\n\n[unsafe](javascript:alert%281%29)\n\n[ref][bad]\n\n[bad]: file:///etc/passwd\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.doesNotMatch(html, /<script|<img|href="javascript:|href="file:/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<table>/);
  assert.match(html, /Bild/);
  const named = await documentExportHtml("Heading", "# Heading\n\nBody");
  assert.equal((named.match(/<h1>/g) || []).length, 1);
});

test("PDF export creates multiple pages and embeds Unicode font maps", async () => {
    const source = "# Größenübersicht\n\n- [x] Fertig\n\n| Name | Wert |\n| --- | --- |\n| Öl | 42 |\n\n" + Array.from({ length: 95 }, (_, i) => "Abschnitt " + i + ": Überprüfung für größere Dokumente. " .repeat(8)).join("\n\n") + "\n\nENDE-DES-DOKUMENTS";
    const pdf = await documentExportPdf("Größenübersicht", source);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const objects = pdf.toString("latin1");
    assert.ok((objects.match(/\/Type\s*\/Page\b/g) || []).length > 1, "Multiple PDF pages");
    assert.match(objects, /\/ToUnicode\b/, "Embedded Unicode font maps");
});
