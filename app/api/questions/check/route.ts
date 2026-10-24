import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionForUser } from "@/lib/subscription";

type Body = {
  questionId?: string;
  selectedOption?: string;
};

/**
 * Valida a resposta no servidor e só devolve gabarito/explicação
 * se a assinatura estiver ativa.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "unauthenticated",
          message: "Faça login para corrigir questões.",
        },
        { status: 401 }
      );
    }

    const sub = await getSubscriptionForUser(supabase, user.id);
    if (!sub.hasAccess) {
      return NextResponse.json(
        {
          error: "subscription_required",
          message:
            sub.message ||
            "Assinatura ativa necessária para ver gabarito e explicações.",
        },
        { status: 403 }
      );
    }

    const body = (await request.json()) as Body;
    const selected = (body.selectedOption || "").trim().toLowerCase();
    let questionId = (body.questionId || "").trim();

    if (!questionId || !selected) {
      return NextResponse.json(
        { error: "invalid_body", message: "questionId e selectedOption são obrigatórios." },
        { status: 400 }
      );
    }

    // IDs do app usam prefixo "supabase:"
    if (questionId.startsWith("supabase:")) {
      questionId = questionId.slice("supabase:".length);
    }

    const { data, error } = await supabase
      .from("questions")
      .select("id, correct_option, explanation, active")
      .eq("id", questionId)
      .eq("active", true)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { error: "question_not_found", message: "Questão não encontrada." },
        { status: 404 }
      );
    }

    const correctOption = String(data.correct_option || "")
      .trim()
      .toLowerCase();
    const correct = correctOption === selected;

    return NextResponse.json({
      correct,
      correctOption,
      explanation: String(data.explanation || "").trim(),
    });
  } catch (error) {
    console.error("[questions/check]", error);
    return NextResponse.json(
      { error: "server_error", message: "Erro ao corrigir a questão." },
      { status: 500 }
    );
  }
}
