import assert from "node:assert/strict";
import test from "node:test";
import { extractSuggestions, stripSuggestionsFromParts, RESPONSE_SUGGESTIONS_PROMPT } from "../lib/response-suggestions";
import { METIS_SHARED_AGENT_CONTROL } from "../lib/agent-control";

test("suggestions preserve labels and composer prompts while cleaning the visible answer", () => {
  assert.deepEqual(extractSuggestions("Die Optionen sind bereit.\n\n```suggestions\n- Beispiel => Zeig mir ein konkretes Beispiel.\n2. Optionen vergleichen\n```"), {
    text: "Die Optionen sind bereit.",
    suggestions: [{ label: "Beispiel", prompt: "Zeig mir ein konkretes Beispiel." }, "Optionen vergleichen"],
  });
});

test("ordinary answers, other code fences, and incomplete streaming blocks are not suggestions", () => {
  for (const text of ["Fertig.", "```ts\nconst suggestions = [];\n```", "```suggestions\nBeispiel"]) {
    assert.deepEqual(extractSuggestions(text), { text, suggestions: [] });
  }
});

test("legacy five-reply limit and Windows newlines stay compatible", () => {
  const result = extractSuggestions("Antwort\r\n```suggestions\r\nA\r\nB => Antwort B\r\nC\r\nD\r\nE\r\nF\r\n```");
  assert.equal(result.suggestions.length, 5);
  assert.deepEqual(result.suggestions[1], { label: "B", prompt: "Antwort B" });
});

test("removing a streamed block preserves ordered tools and thought content", () => {
  const parts = [
    { type: "text", content: "Prüfung gestartet.\n" },
    { type: "tool", id: "inspect", content: "unchanged" },
    { type: "thinking", content: "private thoughts" },
    { type: "text", content: "Ergebnis.\n```sug" },
    { type: "text", content: "gestions\nBeispiel => Zeig ein Beispiel\n```" },
  ];
  assert.deepEqual(stripSuggestionsFromParts(parts), [parts[0], parts[1], parts[2], { type: "text", content: "Ergebnis.\n" }]);
  assert.ok(parts[3].content.includes("```sug"));
});

test("the shared provider contract carries the complete suggestion instruction", () => {
  assert.ok(METIS_SHARED_AGENT_CONTROL.includes(RESPONSE_SUGGESTIONS_PROMPT));
  const example = RESPONSE_SUGGESTIONS_PROMPT.match(/```suggestions\n[\s\S]*?```/)![0];
  assert.equal(extractSuggestions(example).suggestions.length, 2);
});
