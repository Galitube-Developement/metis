import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

export type QuestionOption = {
  label: string;
  value?: string;
};

export type AgentQuestion = {
  id: string;
  question: string;
  multiple?: boolean;
  options?: QuestionOption[];
};

type PendingQuestion = {
  questionId: string;
  questions: AgentQuestion[];
  answers?: string[];
  resolve: (answers: string[]) => void;
};
type PersistedQuestion = Pick<PendingQuestion, "questionId" | "questions" | "answers">;

const pendingQuestions = new Map<string, PendingQuestion>();
const questionsPath = path.join(
  config.dataDir,
  "questions.json",
);
const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 12;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_OPTION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 4_000;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readPersisted(): PersistedQuestion[] {
  try {
    return existsSync(questionsPath)
      ? (JSON.parse(readFileSync(questionsPath, "utf8")) as PersistedQuestion[])
      : [];
  } catch {
    return [];
  }
}

function writePersisted(items: PersistedQuestion[]) {
  mkdirSync(path.dirname(questionsPath), { recursive: true });
  const tmp = `${questionsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  renameSync(tmp, questionsPath);
}

export function createPendingQuestion(
  input: Array<{
    question: string;
    multiple?: boolean;
    options?: Array<QuestionOption | string>;
  }>,
): {
  questionId: string;
  questions: AgentQuestion[];
  promise: Promise<string[]>;
} {
  const questions = input
    .slice(0, MAX_QUESTIONS)
    .map((item) => {
      const question = text(item.question, MAX_QUESTION_LENGTH);
      const options = Array.isArray(item.options)
        ? item.options
            .slice(0, MAX_OPTIONS)
            .map((option) => {
              if (typeof option === "string") {
                const label = text(option, MAX_OPTION_LENGTH);
                return label ? { label, value: label } : null;
              }
              const label = text(option?.label, MAX_OPTION_LENGTH);
              if (!label) return null;
              const value = text(option?.value, MAX_OPTION_LENGTH);
              return { label, ...(value ? { value } : {}) };
            })
            .filter((option): option is QuestionOption => Boolean(option))
        : undefined;
      return {
        id: randomUUID(),
        question,
        ...(item.multiple ? { multiple: true } : {}),
        ...(options?.length ? { options } : {}),
      };
    })
    .filter((item) => item.question);

  const questionId = randomUUID();
  let resolvePending!: (answers: string[]) => void;
  const promise = new Promise<string[]>((resolve) => {
    resolvePending = resolve;
  });
  const pending = {
    questionId,
    questions,
    resolve: resolvePending,
  };
  pendingQuestions.set(questionId, pending);
  writePersisted([...readPersisted().filter((item) => item.questionId !== questionId), {
    questionId,
    questions,
  }]);
  return { questionId, questions, promise };
}

export function resolveQuestion(
  questionId: string,
  answers: string[],
): boolean {
  const pending = pendingQuestions.get(questionId);
  const persisted = readPersisted().find((item) => item.questionId === questionId);
  if (!pending && !persisted) return false;
  const questionSet = pending?.questions ?? persisted?.questions ?? [];
  const normalized = questionSet.map((_, index) =>
    text(answers[index], MAX_ANSWER_LENGTH),
  );
  if (normalized.some((answer) => !answer)) return false;
  if (pending) {
    pendingQuestions.delete(questionId);
    pending.resolve(normalized);
  }
  writePersisted(readPersisted().map((item) => item.questionId === questionId ? { ...item, answers: normalized } : item));
  return true;
}

export function getQuestionAnswer(questionId: string) {
  return readPersisted().find((item) => item.questionId === questionId)?.answers ?? null;
}

export function questionLimits() {
  return {
    maxQuestions: MAX_QUESTIONS,
    maxAnswerLength: MAX_ANSWER_LENGTH,
  };
}
