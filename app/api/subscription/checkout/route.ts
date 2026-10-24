import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Inicia o checkout de assinatura recorrente no Mercado Pago.
 *
 * - Credenciais apenas no servidor.
 * - Não ativa assinatura; apenas devolve URL de checkout.
 * - A confirmação real virá do webhook.
 *
 * Depende de: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_PLAN_ID (ou lógica de Preapproval),
 * e da tabela subscriptions (criada pelo agente Supabase).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "unauthenticated", message: "Faça login para assinar." },
        { status: 401 }
      );
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const planId = process.env.MERCADOPAGO_PLAN_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "not_configured",
          message:
            "Mercado Pago ainda não configurado no servidor. Defina MERCADOPAGO_ACCESS_TOKEN.",
        },
        { status: 503 }
      );
    }

    let body: { planId?: string } = {};
    try {
      body = await request.json();
    } catch {
      // body opcional
    }

    const externalReference = `user:${user.id}:${Date.now()}`;
    const effectivePlanId = body.planId || planId;

    // Fluxo de Preapproval (assinaturas) do Mercado Pago.
    // Documentação: https://www.mercadopago.com.br/developers/pt/docs/subscriptions
    // O payload exato pode variar conforme o produto (Preapproval vs Subscriptions API).
    // Ajuste fino fica a cargo da configuração de produção / testes.

    const preapprovalPayload: Record<string, unknown> = {
      reason: "Rumo à Farda — Assinatura de estudos PMERJ",
      external_reference: externalReference,
      payer_email: user.email,
      back_url: `${appUrl}/assinatura?retorno=ok`,
      status: "pending",
    };

    if (effectivePlanId) {
      preapprovalPayload.preapproval_plan_id = effectivePlanId;
    } else {
      // Placeholder: valor e frequência devem ser definidos comercialmente.
      // NÃO inventar preço em produção. Este bloco só permite testar a estrutura.
      preapprovalPayload.auto_recurring = {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 1,
        currency_id: "BRL",
      };
    }

    const mpResponse = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preapprovalPayload),
      }
    );

    const mpData = (await mpResponse.json()) as {
      id?: string;
      init_point?: string;
      sandbox_init_point?: string;
      message?: string;
      error?: string;
    };

    if (!mpResponse.ok) {
      console.error("[checkout] Mercado Pago error:", mpData);
      return NextResponse.json(
        {
          error: "mercadopago_error",
          message:
            mpData.message ||
            "Não foi possível iniciar o checkout. Tente novamente mais tarde.",
        },
        { status: 502 }
      );
    }

    const checkoutUrl =
      mpData.init_point || mpData.sandbox_init_point || null;

    if (!checkoutUrl) {
      return NextResponse.json(
        {
          error: "no_checkout_url",
          message: "Mercado Pago não retornou URL de checkout.",
        },
        { status: 502 }
      );
    }

    // Opcional: registrar pending via service role quando a tabela existir.
    // Não falha o fluxo se a tabela ainda não existir.
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      await admin.from("subscriptions").upsert(
        {
          user_id: user.id,
          status: "pending",
          mp_preapproval_id: mpData.id ?? null,
          plan_id: effectivePlanId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch (e) {
      console.warn(
        "[checkout] Não foi possível registrar pending (tabela pode não existir):",
        e
      );
    }

    return NextResponse.json({
      checkoutUrl,
      externalReference,
      preapprovalId: mpData.id ?? null,
    });
  } catch (error) {
    console.error("[subscription/checkout]", error);
    return NextResponse.json(
      { error: "server_error", message: "Erro interno ao iniciar checkout." },
      { status: 500 }
    );
  }
}
