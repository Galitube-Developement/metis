import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import type { AgentQuestion, QuestionOption } from "@/lib/questions";

type QuestionStatus = "waiting_for_user" | "answered" | "cancelled" | "expired";

type StoredQuestion = {
  questionId: string;
  runId?: string;
  jobId?: string;
  version: number;
  status: QuestionStatus;
  expiresAt?: string;
  questions: AgentQuestion[];
  answers?: string[];
};

export function questionLimits() {
  return {
    maxQuestions: 8,
    maxAnswerLength: 4_000,
  };
}

function parseStored(data: unknown): StoredQuestion | null {
  if (!data || typeof data !== "object") return null;
  try {
    const item = JSON.parse(String((data as { data?: unknown }).data || "")) as StoredQuestion;
    return item && typeof item.questionId === "string" && Array.isArray(item.questions) ? item : null;
  } catch {
    return null;
  }
}

function answerFallback(status: QuestionStatus, count: number) {
  const message = status === "expired"
    ? "[No answer received before the question timed out.]"
    : "[The question was cancelled.]";
  return Array.from({ length: count }, () => message);
}

export function createPendingQuestion(
  input: Array<{ question: string; multiple?: boolean; options?: Array<QuestionOption | string> }>,
  chatId: string,
  userId?: string,
  context: { jobId?: string; runId?: string } = {},
) {
  const questions: AgentQuestion[] = input.slice(0, 8).map((item) => ({
    id: randomUUID(),
    question: item.question.trim().slice(0, 2_000),
    ...(item.multiple ? { multiple: true } : {}),
    ...(item.options?.length ? {
      options: item.options.slice(0, 12).map((option) =>
        typeof option === "string"
          ? { label: option.slice(0, 500), value: option.slice(0, 500) }
          : option,
      ),
    } : {}),
  })).filter((item) => item.question);
  const questionId = randomUUID();
  const version = 1;
  const stored: StoredQuestion = {
    questionId,
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    version,
    status: "waiting_for_user",
    questions,
  };
  const timestamp = new Date().toISOString();
  getDatabase().prepare(
    `INSERT INTO pending_questions
      (question_id, chat_id, user_id, data, created_at, run_id, job_id, version, expires_at, status, heartbeat_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    questionId,
    chatId,
    userId ?? null,
    JSON.stringify(stored),
    timestamp,
    context.runId ?? null,
    context.jobId ?? null,
    version,
    null,
    stored.status,
    timestamp,
  );
  let stopped = false;
  const promise = (async () => {
    while (!stopped) {
      const row = getDatabase().prepare(
        "SELECT data, status, expires_at as expiresAt FROM pending_questions WHERE question_id = ?",
      ).get(questionId) as { data?: string; status?: QuestionStatus; expiresAt?: string } | undefined;
      const data = parseStored(row);
      if (!data) return answerFallback("cancelled", questions.length);
      if (data.status === "answered" && data.answers) return data.answers;
      if (data.status === "cancelled" || data.status === "expired") {
        return data.answers || answerFallback(data.status, questions.length);
      }
      getDatabase().prepare(
        "UPDATE pending_questions SET heartbeat_at = ? WHERE question_id = ? AND status = 'waiting_for_user'",
      ).run(new Date().toISOString(), questionId);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return answerFallback("cancelled", questions.length);
  })();
  return {
    questionId,
    questions,
    version,
    promise,
    stop: () => {
      stopped = true;
    },
  };
}

export type ResolvedQuestion = {
  questionId: string;
  chatId: string;
  jobId?: string;
  runId?: string;
  version: number;
  status: QuestionStatus;
  answers: string[];
  heartbeatAt?: string;
};

export function resolveQuestion(
  questionId: string,
  answers: string[],
  userId?: string,
  expectedVersion?: number,
): ResolvedQuestion | false {
  return transaction(() => {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT chat_id as chatId, data, user_id as userId, version, status, heartbeat_at as heartbeatAt
       FROM pending_questions WHERE question_id = ?`,
    ).get(questionId) as {
      chatId?: string;
      data?: string;
      userId?: string;
      version?: number;
      status?: QuestionStatus;
      heartbeatAt?: string;
    } | undefined;
    if (!row?.data || (userId && row.userId !== userId)) return false;
    const data = parseStored({ data: row.data });
    if (!data || !row.chatId) return false;
    if (data.status === "answered" && data.answers) {
      return { questionId, chatId: row.chatId, ...(data.jobId ? { jobId: data.jobId } : {}), ...(data.runId ? { runId: data.runId } : {}), version: data.version, status: data.status, answers: data.answers, heartbeatAt: row.heartbeatAt };
    }
    if (expectedVersion !== undefined && expectedVersion !== (row.version || data.version)) return false;
    if (data.status !== "waiting_for_user") return false;
    if (answers.length !== data.questions.length || answers.some((answer) => !answer.trim() || answer.length > 4_000)) return false;
    const normalized = answers.map((answer) => answer.trim().slice(0, 4_000));
    const updated: StoredQuestion = { ...data, answers: normalized, status: "answered", version: data.version + 1 };
    const changed = db.prepare(
      `UPDATE pending_questions
       SET data = ?, version = ?, status = ?, heartbeat_at = ?
       WHERE question_id = ? AND status = 'waiting_for_user' AND version = ?`,
    ).run(JSON.stringify(updated), updated.version, updated.status, new Date().toISOString(), questionId, data.version);
    if (!changed.changes) return false;
    return {
      questionId,
      chatId: row.chatId,
      ...(data.jobId ? { jobId: data.jobId } : {}),
      ...(data.runId ? { runId: data.runId } : {}),
      version: updated.version,
      status: updated.status,
      answers: normalized,
      heartbeatAt: row.heartbeatAt,
    };
  });
}

export function cancelQuestion(questionId: string, userId?: string): ResolvedQuestion | false {
  return transitionQuestion(questionId, "cancelled", userId);
}

function transitionQuestion(questionId: string, status: "cancelled" | "expired", userId?: string): ResolvedQuestion | false {
  return transaction(() => {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT chat_id as chatId, user_id as userId, data, version, status, heartbeat_at as heartbeatAt FROM pending_questions WHERE question_id = ?",
    ).get(questionId) as { chatId?: string; userId?: string; data?: string; version?: number; status?: QuestionStatus; heartbeatAt?: string } | undefined;
    if (!row?.chatId || !row.data || (userId && row.userId !== userId)) return false;
    const data = parseStored({ data: row.data });
    if (!data) return false;
    if (data.status === status && data.answers) {
      return { questionId, chatId: row.chatId, ...(data.jobId ? { jobId: data.jobId } : {}), ...(data.runId ? { runId: data.runId } : {}), version: data.version, status, answers: data.answers, heartbeatAt: row.heartbeatAt };
    }
    if (data.status !== "waiting_for_user") return false;
    const updated = { ...data, status, version: data.version + 1 };
    db.prepare(
      "UPDATE pending_questions SET data = ?, version = ?, status = ?, heartbeat_at = ? WHERE question_id = ? AND status = 'waiting_for_user' AND version = ?",
    ).run(JSON.stringify(updated), updated.version, status, new Date().toISOString(), questionId, data.version);
    return {
      questionId,
      chatId: row.chatId,
      ...(data.jobId ? { jobId: data.jobId } : {}),
      ...(data.runId ? { runId: data.runId } : {}),
      version: updated.version,
      status,
      answers: answerFallback(status, data.questions.length),
      heartbeatAt: row.heartbeatAt,
    };
  });
}

export function getPendingQuestion(questionId: string, userId?: string) {
  const row = getDatabase().prepare(
    "SELECT chat_id as chatId, user_id as userId, data, heartbeat_at as heartbeatAt FROM pending_questions WHERE question_id = ?",
  ).get(questionId) as { chatId?: string; userId?: string; data?: string; heartbeatAt?: string } | undefined;
  if (!row?.data || (userId && row.userId !== userId)) return null;
  const data = parseStored({ data: row.data });
  return data && row.chatId ? { ...data, chatId: row.chatId, heartbeatAt: row.heartbeatAt } : null;
}

export function deletePendingQuestion(questionId: string) {
  getDatabase().prepare("DELETE FROM pending_questions WHERE question_id = ? AND status <> 'waiting_for_user'").run(questionId);
}
