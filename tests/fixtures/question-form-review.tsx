"use client";
import { useState } from "react";
import { QuestionForm } from "@/components/question-form";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { normalizeAskUserInput, initialQuestionAnswers, questionSummary, type AgentQuestion, type AskUserInput, type QuestionAnswers } from "@/lib/question-contract";
const monitor: AskUserInput = {
  title: "Eine wichtige Frage habe ich noch",
  description: "Welche Bildwiederholraten haben die beiden Monitore an deiner RTX 4060 Ti?",
  columns: 2, submitLabel: "Weiter diagnostizieren",
  responseTemplate: "Die beiden Monitore laufen mit {{monitor1Hz}} und {{monitor2Hz}}. Nach dem Deaktivieren beider Monitore: {{testResult}}.",
  questions: [
    { key: "monitor1Hz", question: "Monitor 1 (4060 Ti)", type: "select", icon: "monitor", default: 60, options: [{ label: "60 Hz", value: 60 }, { label: "120 Hz", value: 120 }, { label: "144 Hz", value: 144 }, { label: "165 Hz", value: 165 }] },
    { key: "monitor2Hz", question: "Monitor 2 (4060 Ti)", type: "select", icon: "monitor", default: 60, options: [{ label: "60 Hz", value: 60 }, { label: "120 Hz", value: 120 }, { label: "144 Hz", value: 144 }] },
    { key: "testResult", question: "Ergebnis von Test 1 (beide Monitore deaktiviert)", type: "radio", width: "full", options: [
      { label: "GPU-1-Auslastung sinkt auf 0 % oder fast 0 %", value: "idle" },
      { label: "GPU 1 bleibt bei ungefähr 40 %", value: "unchanged" },
      { label: "Noch nicht getestet", value: "untested" },
    ] },
    { key: "gpuLoad", question: "Gemessene GPU-Auslastung", type: "number", min: 0, max: 100, unit: "%", required: false, icon: "gauge", showWhen: { key: "testResult", equals: "unchanged" } },
  ],
};
const full: AskUserInput = { title: "Einstellungen für die Diagnose", columns: 2, submitLabel: "Eingaben übernehmen", questions: [
  { key: "name", question: "Gerätename", type: "text", icon: "monitor", placeholder: "Gaming-PC" },
  { key: "count", question: "Anzahl Monitore", type: "number", min: 1, max: 6, step: 1, default: 2, icon: "list-checks" },
  { key: "enabled", question: "Erweiterte Diagnose", type: "toggle", icon: "settings" },
  { key: "tested", question: "Neustart bereits getestet", type: "checkbox" },
  { key: "load", question: "GPU-Auslastung", type: "slider", min: 0, max: 100, default: 40, unit: "%", width: "full" },
  { key: "date", question: "Testdatum", type: "date", default: "2026-10-10" },
  { key: "time", question: "Testzeit", type: "time", required: false },
  { key: "apps", question: "Programme beim Test", type: "multiselect", options: [{ label: "Browser", value: "browser", icon: "globe" }, { label: "Discord", value: "discord", description: "Mit oder ohne Overlay" }], allowCustom: true, width: "full" },
  { key: "comment", question: "Weitere Beobachtungen", type: "textarea", maxLength: 500, required: false, width: "full", placeholder: "Was verändert sich beim Schließen der Programme?" },
  { key: "details", question: "Erweiterte Details", type: "text", showWhen: { key: "enabled", equals: true }, width: "full" },
] };
function prepare(input: AskUserInput) {
  const normalized = normalizeAskUserInput(input);
  return { ...normalized, questionId: input === monitor ? "monitor-review" : "full-review", questions: normalized.questions.map((q, i) => ({ ...q, id: String(i) })) as AgentQuestion[] };
}
export function QuestionFormReview() {
  const [extended, setExtended] = useState(false);
  const form = prepare(extended ? full : monitor);
  const [answers, setAnswers] = useState(initialQuestionAnswers(prepare(monitor).questions));
  const [custom, setCustom] = useState<string[]>([]);
  const [active, setActive] = useState<boolean[]>([]);
  const [submitted, setSubmitted] = useState<QuestionAnswers | null>(null);
  const [sending, setSending] = useState(false);
  function reset(next: boolean) { setExtended(next); setAnswers(initialQuestionAnswers(prepare(next ? full : monitor).questions)); setCustom([]); setActive([]); setSubmitted(null); }
  return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
    <div className="mb-6 flex justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">Metis AI</p><Button variant="ghost" size="sm" onClick={() => reset(!extended)}>{extended ? "Monitor-Beispiel" : "Weitere Eingaben"}</Button></div>
    {submitted ? <>
      <div className="ml-auto mb-8 max-w-xl rounded-xl bg-secondary px-4 py-3 text-sm leading-relaxed">{questionSummary(form, form.questions, submitted.values)}</div>
      <Markdown content={"## Die nächsten Diagnoseschritte\n\n### [icon:gauge] 1. Tatsächliche GPU-Auslastung prüfen\n\nÖffne **Task-Manager → Leistung → GPU 1**. Vergleiche die 3D-Auslastung mit dem Wert unter Prozesse.\n\n---\n\n### [icon:settings] 2. Hardwarebeschleunigung testen\n\nÖffne **Einstellungen → System → Anzeige → Grafik**. Notiere den aktuellen Wert, bevor du ihn testweise änderst.\n\n---\n\n### [icon:monitor] 3. Programme einzeln schließen\n\nPrüfe nach jedem geschlossenen Programm, ob die GPU-Auslastung sinkt."} />
      <pre data-testid="typed-values" className="mt-8 overflow-auto text-xs text-muted-foreground">{JSON.stringify(submitted.values, null, 2)}</pre>
      <Button onClick={() => reset(extended)} variant="ghost" className="mt-4">Zurücksetzen</Button>
    </> : <QuestionForm key={form.questionId} form={form} answers={answers} custom={custom} customActive={active} disabled={sending}
      onAnswersChange={setAnswers} onCustomChange={setCustom} onCustomActiveChange={setActive}
      onCancel={() => reset(extended)} onSubmit={result => { setSending(true); window.setTimeout(() => { setSubmitted(result); setSending(false); }, 600); }} />}
  </main>;
}
