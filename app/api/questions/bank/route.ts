import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionForUser } from "@/lib/subscription";
import {
  loadQuestionBankPublic,
  loadQuestionBankPremium,
} from "@/lib/question-bank";

/**
 * Entrega o banco de questões.
 *
 * - Sem assinatura ativa: questões SEM correctAnswer e SEM explanation.
 * - Com assinatura ativa: ainda preferimos não enviar gabarito em massa;
 *   o cliente usa /api/questions/check para corrigir.
 *
 * A proteção definitiva também exige ajuste de RLS no Supabase
 * (ver docs/CONTRATO_SUPABASE.md).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const sub = await getSubscriptionForUser(supabase, user?.id ?? null);

    // Sempre carregar versão pública (sem gabarito) para o payload inicial.
    // Mesmo com premium, o gabarito sai só no endpoint de check.
    const result = sub.hasAccess
      ? await loadQuestionBankPremium(supabase)
      : await loadQuestionBankPublic(supabase);

    return NextResponse.json({
      ...result,
      hasAccess: sub.hasAccess,
      subscriptionStatus: sub.status,
    });
  } catch (error) {
    console.error("[questions/bank]", error);
    return NextResponse.json(
      {
        subjects: [],
        questions: [],
        error: "Não foi possível carregar o banco de questões.",
        hasAccess: false,
        subscriptionStatus: "none",
      },
      { status: 500 }
    );
  }
}
