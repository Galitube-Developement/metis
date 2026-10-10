type Tool = { id: string; name: string; status?: string; result?: string };
type Part = { type: string; content?: string; id?: string; name?: string; status?: string; result?: string };

export type QuestionAnswerAnchor = { assistantMessageId: string; toolCallId: string };
export type QuestionAnswerReference = { questionId: string } & Partial<QuestionAnswerAnchor>;
type TranscriptMessage = {
  id: string;
  role: string;
  content: string;
  parts?: readonly Part[];
  tools?: readonly Tool[];
  questionAnswer?: QuestionAnswerReference;
};

function isQuestionTool(name = "") {
  return /(?:^|__|[/.])ask_user$/.test(name);
}

function partsFor(message: TranscriptMessage): Part[] {
  if (message.parts?.length) return [...message.parts];
  return [
    ...(message.tools ?? []).map(tool => ({ ...tool, type: "tool" })),
    ...(message.content ? [{ type: "text", content: message.content }] : []),
  ];
}

function resultQuestionId(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return;
  if (typeof value === "string") {
    if (value.length > 256_000) return;
    try { return resultQuestionId(JSON.parse(value), depth + 1); } catch { return; }
  }
  if (!value || typeof value !== "object") return;
  const object = value as { questionId?: unknown; content?: unknown; text?: unknown };
  if (typeof object.questionId === "string") return object.questionId;
  if (Array.isArray(object.content)) {
    for (const item of object.content) {
      const id = resultQuestionId(item, depth + 1);
      if (id) return id;
    }
  }
  if (typeof object.text === "string") return resultQuestionId(object.text, depth + 1);
}

function questionId(message: TranscriptMessage) {
  return message.role === "user"
    ? message.questionAnswer?.questionId || message.id.match(/^question-answer-(.+)$/)?.[1]
    : undefined;
}

function answerAnchors(messages: readonly TranscriptMessage[]) {
  const calls = messages.flatMap((message, messageIndex) => message.role === "assistant"
    ? partsFor(message).flatMap((part, partIndex) => part.type === "tool" && part.id && isQuestionTool(part.name)
      ? [{ assistantMessageId: message.id, toolCallId: part.id, messageIndex, partIndex, questionId: resultQuestionId(part.result), failed: part.status === "error" }]
      : [])
    : []);
  const used = new Set<string>();
  const anchors = new Map<string, QuestionAnswerAnchor>();
  const key = (call: QuestionAnswerAnchor) => JSON.stringify([call.assistantMessageId, call.toolCallId]);
  // Explicit persisted links and tool results win over historical chronological matching.
  for (const message of messages) {
    const id = questionId(message);
    if (!id) continue;
    const ref = message.questionAnswer;
    const call = calls.find(call => ref?.assistantMessageId && ref.toolCallId
      ? call.assistantMessageId === ref.assistantMessageId && call.toolCallId === ref.toolCallId
      : call.questionId === id);
    if (call && !used.has(key(call))) {
      anchors.set(message.id, { assistantMessageId: call.assistantMessageId, toolCallId: call.toolCallId });
      used.add(key(call));
    }
  }
  messages.forEach((message, index) => {
    if (!questionId(message) || anchors.has(message.id) || message.questionAnswer?.assistantMessageId) return;
    // Older transcripts defer raw tool results. Pair each answer with the first
    // remaining ask_user in the nearest preceding assistant turn, never another chat.
    const eligible = calls.filter(call => call.messageIndex < index && !call.failed && !used.has(key(call)));
    const nearest = eligible.at(-1)?.messageIndex;
    const call = eligible.find(call => call.messageIndex === nearest);
    if (call) {
      anchors.set(message.id, { assistantMessageId: call.assistantMessageId, toolCallId: call.toolCallId });
      used.add(key(call));
    }
  });
  return anchors;
}

/** Persist the link while the provider's tool result is still in flight. */
export function questionAnswerAnchor(messages: readonly TranscriptMessage[], id: string): QuestionAnswerAnchor | undefined {
  const answer = { id: "question-answer-" + id, role: "user", content: "" };
  return answerAnchors([...messages, answer]).get(answer.id);
}

/** Display-only splitting: keep the persisted/provider transcript unchanged. */
export function projectQuestionTranscript<T extends TranscriptMessage>(messages: readonly T[]): T[] {
  const anchors = answerAnchors(messages);
  if (!anchors.size) return [...messages];
  const answers = new Map<string, T>();
  for (const message of messages) {
    const anchor = anchors.get(message.id);
    if (anchor) answers.set(JSON.stringify([anchor.assistantMessageId, anchor.toolCallId]), message);
  }
  const result: T[] = [];
  for (const message of messages) {
    if (anchors.has(message.id)) continue;
    if (message.role !== "assistant") { result.push(message); continue; }
    const parts = partsFor(message);
    const boundaries = parts.flatMap((part, index) => part.type === "tool" && part.id
      ? [{ index, answer: answers.get(JSON.stringify([message.id, part.id])) }].filter(item => item.answer)
      : []);
    if (!boundaries.length) { result.push(message); continue; }
    let start = 0;
    let segmentId = message.id;
    const segment = (end: number, last: boolean) => {
      const slice = parts.slice(start, end);
      result.push({
        ...message, id: segmentId, transcriptSourceId: message.id, parts: slice,
        content: slice.filter(part => part.type === "text").map(part => part.content ?? "").join(""),
        tools: slice.filter(part => part.type === "tool"),
        thinking: undefined, thinkingDone: undefined, thinkingDurationMs: undefined,
        ...(last ? {} : { streaming: false, runMetadata: undefined, suggestions: undefined, attachments: undefined }),
      } as T);
    };
    for (const boundary of boundaries) {
      segment(boundary.index + 1, boundary.index + 1 === parts.length);
      result.push(boundary.answer!);
      start = boundary.index + 1;
      segmentId = message.id + ":after:" + boundary.answer!.id;
    }
    if (start < parts.length) segment(parts.length, true);
  }
  return result;
}
