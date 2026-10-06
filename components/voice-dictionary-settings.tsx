"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_DICTIONARY_WORDS, MAX_DICTIONARY_WORD_LENGTH, normalizeVoiceDictionary } from "@/lib/voice-dictionary";

export function VoiceDictionarySettings() {
  const [words, setWords] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editWord, setEditWord] = useState("");
  const [live, setLive] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setError("");
    void fetch("/api/preferences", { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load dictionary.");
        if (!controller.signal.aborted) {
          setWords(normalizeVoiceDictionary(data.settings?.voiceInput?.dictionary));
          setLive(data.settings?.voiceInput?.realtime === true || data.settings?.voiceInput?.provider === "browser");
          setLoaded(true);
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load dictionary.");
      });
    return () => controller.abort();
  }, [reload]);

  async function save(next: string[], action: "add" | "edit" | "delete") {
    if (busy || !loaded) return;
    if (action !== "delete" && normalizeVoiceDictionary(next).length !== next.length) {
      setError("This word is already in your dictionary.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceInput: { dictionary: next } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save dictionary.");
      setWords(normalizeVoiceDictionary(data.settings?.voiceInput?.dictionary));
      if (action === "add") setDraft("");
      setEditingIndex(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save dictionary.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex max-w-3xl flex-col gap-4" aria-label="Dictionary" aria-busy={busy}>
      <p className="text-xs text-muted-foreground">
        Add one word or phrase per entry. Names and technical terms help transcription use your preferred spelling. Keep the list short; recognition is not guaranteed.
      </p>
      {live ? <p className="text-xs text-muted-foreground">Your current live transcription mode does not use this dictionary. Switch off Live transcription in Voice input to use it with recorded audio.</p> : null}
      {loaded ? <p role="status" className="text-xs text-muted-foreground">{words.length} {words.length === 1 ? "word" : "words"} saved{busy ? " · Saving…" : ""}</p> : null}
      <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void save([...words, draft.trim()], "add"); }}>
        <Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add a word or phrase…" aria-label="New dictionary word" maxLength={MAX_DICTIONARY_WORD_LENGTH} disabled={!loaded || busy || words.length >= MAX_DICTIONARY_WORDS} />
        <Button size="icon" type="submit" disabled={!loaded || busy || !draft.trim() || words.length >= MAX_DICTIONARY_WORDS} aria-label="Add word"><Plus className="size-4" /></Button>
      </form>
      {words.length >= MAX_DICTIONARY_WORDS ? <p className="text-xs text-muted-foreground">Dictionary is full. Remove a word to add another.</p> : null}
      {error ? <div className="flex items-center gap-3"><p role="alert" className="text-xs text-destructive">{error}</p>{!loaded ? <Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button> : null}</div> : null}
      {!loaded && !error ? <p role="status" className="text-xs text-muted-foreground">Loading dictionary…</p> : null}
      {loaded ? (
        <ul className="flex flex-col gap-2">
          {!words.length ? <li className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">No dictionary words yet.</li> : words.map((word, index) => (
            <li key={word} className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3">
              {editingIndex === index ? (
                <form className="flex min-w-0 flex-1 flex-col gap-2" onSubmit={event => { event.preventDefault(); void save(words.map((entry, i) => i === index ? editWord.trim() : entry), "edit"); }}>
                  <Input value={editWord} onChange={event => setEditWord(event.target.value)} maxLength={MAX_DICTIONARY_WORD_LENGTH} disabled={busy} aria-label="Edit dictionary word" autoFocus />
                  <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || !editWord.trim()}>Save word</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditingIndex(null)}>Cancel</Button></div>
                </form>
              ) : <p className="min-w-0 flex-1 break-words text-sm">{word}</p>}
              {editingIndex !== index ? <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label={"Edit " + word} onClick={() => { setEditingIndex(index); setEditWord(word); }}><Pencil className="size-3.5" /></Button> : null}
              <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label={"Delete " + word} onClick={() => void save(words.filter((_, i) => i !== index), "delete")}><Trash2 className="size-3.5" /></Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
