import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as browserSupabase } from "./supabase";

export type AppQuestion = {
  id: string;
  subject: string;
  prompt: string;
  options: [string, string][];
  /** Presente apenas quando o backend autorizou (não confiar no cliente). */
  correctAnswer?: string;
  explanation?: string;
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

async function loadSubjects(client: SupabaseClient) {
  const subjectResponse = await client
    .from("subjects")
    .select("id, name, slug")
    .order("name");

  if (subjectResponse.error) {
    return {
      subjects: [] as AppSubject[],
      subjectNames: new Map<string, string>(),
      error: subjectResponse.error.message,
    };
  }

  const subjectRows = (subjectResponse.data ?? []) as RawRecord[];

  const subjects: AppSubject[] = subjectRows
    .filter(
      (row) => typeof row.name === "string" && typeof row.slug === "string"
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

  return { subjects, subjectNames, error: null as string | null };
}

/**
 * Carrega questões SEM gabarito e SEM explicação.
 * Usado para usuários sem assinatura ativa e para o payload inicial do cliente.
 */
export async function loadQuestionBankPublic(
  client: SupabaseClient
): Promise<QuestionBankResult> {
  try {
    const { subjects, subjectNames, error: subjectError } =
      await loadSubjects(client);

    if (subjectError) {
      return { subjects: [], questions: [], error: subjectError };
    }

    // Select explícito SEM correct_option e SEM explanation.
    const questionResponse = await client
      .from("questions")
      .select("id, subject_id, statement, options, difficulty")
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
        typeof row.statement !== "string"
      ) {
        continue;
      }

      const subject = subjectNames.get(row.subject_id);
      const options = normalizeOptions(row.options);

      if (!subject || !row.statement.trim() || options.length < 2) {
        continue;
      }

      questions.push({
        id: `supabase:${row.id}`,
        subject,
        prompt: row.statement.trim(),
        options,
      });
    }

    return { subjects, questions, error: null };
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

/**
 * Carrega questões com metadados; gabarito ainda não é necessário no cliente
 * porque a correção passa por /api/questions/check.
 * Mantido para eventual uso server-side.
 */
export async function loadQuestionBankPremium(
  client: SupabaseClient
): Promise<QuestionBankResult> {
  // Por segurança, o payload ao cliente continua sem gabarito em massa.
  // A correção é feita questão a questão no endpoint /api/questions/check.
  return loadQuestionBankPublic(client);
}

/**
 * Compatibilidade com o código legado (client-side).
 * Prefira /api/questions/bank no cliente autenticado.
 *
 * ATENÇÃO: esta função ainda pode receber correct_option se o RLS
 * do Supabase permitir. O frontend deve preferir a API de servidor.
 * Após o ajuste de RLS, o select abaixo deve ser alinhado ao público.
 */
export async function loadQuestionBank(): Promise<QuestionBankResult> {
  return loadQuestionBankPublic(browserSupabase);
}
