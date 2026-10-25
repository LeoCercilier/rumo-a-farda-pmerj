import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubscriptionForUser } from "@/lib/subscription";

type Body = {
  questionId?: string;
  selectedOption?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Valida a resposta no servidor e só devolve gabarito/explicação
 * se a assinatura estiver ativa.
 *
 * Após autenticar o usuário e confirmar assinatura Premium, consulta
 * correct_option e explanation exclusivamente via cliente administrativo
 * (service role), para continuar funcionando quando o RLS restringir
 * esses campos ao cliente autenticado comum.
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

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "JSON inválido. Envie questionId e selectedOption.",
        },
        { status: 400 }
      );
    }

    if (
      typeof body.questionId !== "string" ||
      typeof body.selectedOption !== "string"
    ) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "questionId e selectedOption devem ser strings.",
        },
        { status: 400 }
      );
    }

    const selected = body.selectedOption.trim().toLowerCase();
    let questionId = body.questionId.trim();

    if (!questionId || !selected) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "questionId e selectedOption são obrigatórios.",
        },
        { status: 400 }
      );
    }

    // IDs do app usam prefixo "supabase:"
    if (questionId.startsWith("supabase:")) {
      questionId = questionId.slice("supabase:".length);
    }

    if (!UUID_RE.test(questionId)) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "questionId inválido.",
        },
        { status: 400 }
      );
    }

    // Somente após sessão + assinatura: leitura do gabarito com service role.
    // O user_id / hasAccess nunca vêm do body do cliente.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("questions")
      .select("id, correct_option, explanation, active")
      .eq("id", questionId)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      console.error("[questions/check] supabase query failed");
      return NextResponse.json(
        { error: "server_error", message: "Erro ao corrigir a questão." },
        { status: 500 }
      );
    }

    if (!data) {
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
    console.error("[questions/check] unexpected error");
    return NextResponse.json(
      { error: "server_error", message: "Erro ao corrigir a questão." },
      { status: 500 }
    );
  }
}