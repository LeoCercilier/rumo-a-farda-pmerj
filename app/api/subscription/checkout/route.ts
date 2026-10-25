
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function getAppUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL;

  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export async function POST() {
  try {
    // Mantém o checkout bloqueado até a integração ser validada.
    if (process.env.BILLING_ENABLED !== "true") {
      return NextResponse.json(
        {
          error: "billing_disabled",
          message:
            "A assinatura está temporariamente indisponível.",
        },
        { status: 503 }
      );
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const planId = process.env.MERCADOPAGO_PLAN_ID;
    const appUrl = getAppUrl();

    if (!accessToken || !planId || !appUrl) {
      return NextResponse.json(
        {
          error: "billing_not_configured",
          message:
            "A configuração da assinatura ainda não foi concluída.",
        },
        { status: 503 }
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error: "unauthenticated",
          message: "Faça login para assinar.",
        },
        { status: 401 }
      );
    }

    if (!user.email) {
      return NextResponse.json(
        {
          error: "email_required",
          message:
            "Sua conta precisa ter um e-mail válido para iniciar a assinatura.",
        },
        { status: 422 }
      );
    }

    const admin = createAdminClient();

    const { data: existing, error: existingError } = await admin
      .from("subscriptions")
      .select("status, mp_preapproval_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingError) {
      console.error(
        "[checkout] Não foi possível consultar a assinatura existente."
      );

      return NextResponse.json(
        {
          error: "subscription_check_failed",
          message:
            "Não foi possível verificar sua assinatura. Tente novamente mais tarde.",
        },
        { status: 503 }
      );
    }

    if (existing?.status === "active") {
      return NextResponse.json(
        {
          error: "subscription_already_active",
          message: "Sua conta já possui uma assinatura ativa.",
        },
        { status: 409 }
      );
    }

    if (
      existing?.status === "pending" &&
      existing.mp_preapproval_id
    ) {
      return NextResponse.json(
        {
          error: "subscription_pending",
          message:
            "Já existe uma assinatura em processamento. Consulte seu status antes de iniciar outra.",
        },
        { status: 409 }
      );
    }

    const externalReference =
      `user:${user.id}:${randomUUID()}`;

    const idempotencyKey = randomUUID();

    const mpResponse = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          preapproval_plan_id: planId,
          external_reference: externalReference,
          payer_email: user.email,
          back_url: `${appUrl}/assinatura?retorno=ok`,
        }),
        cache: "no-store",
      }
    );

    if (!mpResponse.ok) {
      console.error(
        "[checkout] O Mercado Pago recusou a criação da assinatura.",
        { httpStatus: mpResponse.status }
      );

      return NextResponse.json(
        {
          error: "mercadopago_error",
          message:
            "Não foi possível iniciar a assinatura. Tente novamente mais tarde.",
        },
        { status: 502 }
      );
    }

    const mpData = (await mpResponse.json()) as {
      id?: string;
      init_point?: string;
      sandbox_init_point?: string;
      preapproval_plan_id?: string;
    };

    const checkoutUrl =
      mpData.init_point ||
      mpData.sandbox_init_point ||
      null;

    if (!mpData.id || !checkoutUrl) {
      console.error(
        "[checkout] Resposta sem identificador ou URL de checkout."
      );

      return NextResponse.json(
        {
          error: "invalid_checkout_response",
          message:
            "O Mercado Pago não retornou os dados necessários para continuar.",
        },
        { status: 502 }
      );
    }

    const { error: saveError } = await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: user.id,
          status: "pending",
          mp_preapproval_id: mpData.id,
          plan_id: mpData.preapproval_plan_id || planId,
          current_period_start: null,
          current_period_end: null,
          cancelled_at: null,
          raw_payload: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (saveError) {
      console.error(
        "[checkout] Falha ao salvar a assinatura pendente no Supabase."
      );

      // A assinatura pode já existir no Mercado Pago.
      // Não entregar o link evita um pagamento sem registro local confirmado.
      return NextResponse.json(
        {
          error: "subscription_persistence_failed",
          message:
            "Não foi possível registrar a assinatura. Não tente novamente antes de verificar o status com o suporte.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      checkoutUrl,
    });
  } catch {
    console.error(
      "[subscription/checkout] Erro interno ao iniciar checkout."
    );

    return NextResponse.json(
      {
        error: "server_error",
        message:
          "Erro interno ao iniciar a assinatura. Tente novamente mais tarde.",
      },
      { status: 500 }
    );
  }
}
