import { supabase } from "./supabase";

export type AppQuestion = {
  id: string;
  subject: string;
  prompt: string;
  options: [string, string][];
  correctAnswer: string;
  explanation: string;
};

export type AppSubject = {
  name: string;
  slug: string;
};

export type QuestionBankResult = {
  subjects: AppSubject[];
  questions: AppQuestion[];
  error: string | null;
};

type RawRecord = Record<string, unknown>;

function normalizeOptions(value: unknown): [string, string][] {
  const result: [string, string][] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item) && item.length >= 2) {
        const letter = item[0];
        const label = item[1];

        if (
          typeof letter === "string" &&
          typeof label === "string" &&
          letter.trim() &&
          label.trim()
        ) {
          result.push([letter.trim().toLowerCase(), label.trim()]);
        }

        continue;
      }

      if (item && typeof item === "object") {
        const option = item as RawRecord;
        const letter = option.letter ?? option.key;
        const label = option.label ?? option.text ?? option.value;

        if (
          typeof letter === "string" &&
          typeof label === "string" &&
          letter.trim() &&
          label.trim()
        ) {
          result.push([letter.trim().toLowerCase(), label.trim()]);
        }
      }
    }
  } else if (value && typeof value === "object") {
    for (const [letter, label] of Object.entries(value)) {
      if (typeof label === "string" && label.trim()) {
        result.push([letter.trim().toLowerCase(), label.trim()]);
      }
    }
  }

  const seen = new Set<string>();

  return result.filter(([letter]) => {
    if (seen.has(letter)) return false;
    seen.add(letter);
    return true;
  });
}

export async function loadQuestionBank(): Promise<QuestionBankResult> {
  try {
    const subjectResponse = await supabase
      .from("subjects")
      .select("id, name, slug")
      .order("name");

    if (subjectResponse.error) {
      return {
        subjects: [],
        questions: [],
        error: subjectResponse.error.message,
      };
    }

    const subjectRows = (subjectResponse.data ?? []) as RawRecord[];

    const subjects: AppSubject[] = subjectRows
      .filter(
        (row) =>
          typeof row.name === "string" &&
          typeof row.slug === "string"
      )
      .map((row) => ({
        name: row.name as string,
        slug: row.slug as string,
      }));

    const subjectNames = new Map<string, string>();

    for (const row of subjectRows) {
      if (typeof row.id === "string" && typeof row.name === "string") {
        subjectNames.set(row.id, row.name);
      }
    }

    const questionResponse = await supabase
      .from("questions")
      .select(
        "id, subject_id, statement, options, correct_option, explanation, difficulty"
      )
      .eq("active", true);

    if (questionResponse.error) {
      return {
        subjects,
        questions: [],
        error: questionResponse.error.message,
      };
    }

    const questionRows = (questionResponse.data ?? []) as RawRecord[];

    const questions: AppQuestion[] = [];

    for (const row of questionRows) {
      if (
        typeof row.id !== "string" ||
        typeof row.subject_id !== "string" ||
        typeof row.statement !== "string" ||
        typeof row.correct_option !== "string" ||
        typeof row.explanation !== "string"
      ) {
        continue;
      }

      const subject = subjectNames.get(row.subject_id);
      const options = normalizeOptions(row.options);
      const correctAnswer = row.correct_option.trim().toLowerCase();

      if (
        !subject ||
        !row.statement.trim() ||
        options.length < 2 ||
        !options.some(([letter]) => letter === correctAnswer)
      ) {
        continue;
      }

      questions.push({
        id: `supabase:${row.id}`,
        subject,
        prompt: row.statement.trim(),
        options,
        correctAnswer,
        explanation: row.explanation.trim(),
      });
    }

    return {
      subjects,
      questions,
      error: null,
    };
  } catch (error) {
    return {
      subjects: [],
      questions: [],
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível consultar o banco de questões.",
    };
  }
}
