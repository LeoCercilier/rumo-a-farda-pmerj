
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CHECKOUT_LEASE_MINUTES = 5;

type CheckoutAttempt = {
  id: string;
  user_id: string;
  idempotency_key: string;
  external_reference: string;
  status: "creating" | "pending" | "failed";
  mp_preapproval_id: string | null;
  checkout_url: string | null;
  lease_expires_at: string;
};

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

function isMercadoPagoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (
        host === "mercadopago.com" ||
        host.endsWith(".mercadopago.com") ||
        host === "mercadopago.com.br" ||
        host.endsWith(".mercadopago.com.br")
      )
    );
  } catch {
    return false;
  }
}

function errorResponse(
  error: string,
  message: string,
  status: number
) {
  return NextResponse.json({ error, message }, { status });
}

async function savePendingSubscription(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preapprovalId: string,
  planId: string
): Promise<boolean> {
  const { data: existing, error: readError } = await admin
    .from("subscriptions")
    .select("status, mp_preapproval_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) return false;

  if (
    existing?.mp_preapproval_id &&
    existing.mp_preapproval_id !== preapprovalId
  ) {
    console.error(
      "[checkout] Identificador de assinatura divergente."
    );
    return false;
  }

  if (existing?.status === "active") {
    return false;
  }

  const { error } = await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        status: "pending",
        mp_preapproval_id: preapprovalId,
        plan_id: planId,
        current_period_start: null,
        current_period_end: null,
        cancelled_at: null,
        raw_payload: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error(
      "[checkout] Falha ao persistir assinatura pendente."
    );
    return false;
  }

  return true;
}

export async function POST() {
  try {
    // A cobrança continua bloqueada até autorização explícita.
    if (process.env.BILLING_ENABLED !== "true") {
      return errorResponse(
        "billing_disabled",
        "A assinatura está temporariamente indisponível.",
        503
      );
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const planId = process.env.MERCADOPAGO_PLAN_ID;
    const appUrl = getAppUrl();

    if (!accessToken || !planId || !appUrl) {
      return errorResponse(
        "billing_not_configured",
        "A configuração da assinatura ainda não foi concluída.",
        503
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse(
        "unauthenticated",
        "Faça login para assinar.",
        401
      );
    }

    if (!user.email) {
      return errorResponse(
        "email_required",
        "Sua conta precisa ter um e-mail válido para iniciar a assinatura.",
        422
      );
    }

    const admin = createAdminClient();

    const { data: subscription, error: subscriptionError } =
      await admin
        .from("subscriptions")
        .select("status, mp_preapproval_id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (subscriptionError) {
      return errorResponse(
        "subscription_check_failed",
        "Não foi possível verificar sua assinatura. Tente novamente mais tarde.",
        503
      );
    }

    if (subscription?.status === "active") {
      return errorResponse(
        "subscription_already_active",
        "Sua conta já possui uma assinatura ativa.",
        409
      );
    }

    if (
      subscription?.status === "pending" &&
      subscription.mp_preapproval_id
    ) {
      return errorResponse(
        "subscription_pending",
        "Já existe uma assinatura em processamento. Consulte seu status antes de iniciar outra.",
        409
      );
    }

    // Primeiro reservamos uma tentativa persistente.
    // A mesma chave e referência serão reutilizadas em uma repetição segura.
    let attempt: CheckoutAttempt | null = null;

    const { data: inserted, error: insertError } = await admin
      .from("subscription_checkout_attempts")
      .insert({
        user_id: user.id,
        idempotency_key: randomUUID(),
        external_reference: `user:${user.id}:${randomUUID()}`,
        status: "creating",
        lease_expires_at: new Date(
          Date.now() + CHECKOUT_LEASE_MINUTES * 60 * 1000
        ).toISOString(),
      })
      .select(
        "id, user_id, idempotency_key, external_reference, status, mp_preapproval_id, checkout_url, lease_expires_at"
      )
      .single();

    if (!insertError && inserted) {
      attempt = inserted as CheckoutAttempt;
    } else {
      // Uma tentativa já pode ter sido criada por uma requisição concorrente.
      // Nunca substituímos a chave existente automaticamente.
      const { data: existingAttempt, error: attemptReadError } =
        await admin
          .from("subscription_checkout_attempts")
          .select(
            "id, user_id, idempotency_key, external_reference, status, mp_preapproval_id, checkout_url, lease_expires_at"
          )
          .eq("user_id", user.id)
          .maybeSingle();

      if (attemptReadError || !existingAttempt) {
        console.error(
          "[checkout] Não foi possível reservar ou recuperar a tentativa."
        );

        return errorResponse(
          "checkout_attempt_unavailable",
          "Não foi possível preparar o checkout. Tente novamente mais tarde.",
          503
        );
      }

      attempt = existingAttempt as CheckoutAttempt;
    }

    if (attempt.status === "failed") {
      return errorResponse(
        "checkout_attempt_requires_review",
        "A tentativa anterior precisa ser verificada antes de iniciar outra assinatura.",
        409
      );
    }

    if (attempt.status === "pending") {
      if (
        !attempt.mp_preapproval_id ||
        !attempt.checkout_url ||
        !isMercadoPagoCheckoutUrl(attempt.checkout_url)
      ) {
        return errorResponse(
          "checkout_attempt_inconsistent",
          "A tentativa existente precisa ser verificada antes de continuar.",
          409
        );
      }

      const saved = await savePendingSubscription(
        admin,
        user.id,
        attempt.mp_preapproval_id,
        planId
      );

      if (!saved) {
        return errorResponse(
          "subscription_persistence_failed",
          "Não foi possível confirmar o registro da assinatura. Não inicie outra tentativa.",
          503
        );
      }

      return NextResponse.json({
        checkoutUrl: attempt.checkout_url,
      });
    }

    // Se a reserva expirou, não criamos outra assinatura às cegas.
    // O resultado anterior deve ser reconciliado primeiro.
    if (Date.parse(attempt.lease_expires_at) <= Date.now()) {
      return errorResponse(
        "checkout_reconciliation_required",
        "O resultado da tentativa anterior precisa ser verificado antes de continuar. Não tente criar outra assinatura.",
        409
      );
    }

    const mpResponse = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": attempt.idempotency_key,
        },
        body: JSON.stringify({
          preapproval_plan_id: planId,
          external_reference: attempt.external_reference,
          payer_email: user.email,
          back_url: `${appUrl}/assinatura?retorno=ok`,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!mpResponse.ok) {
      // Mantemos a tentativa reservada: uma resposta de erro pode não
      // provar que o Mercado Pago deixou de criar o recurso.
      console.error(
        "[checkout] Resposta não conclusiva do Mercado Pago.",
        { httpStatus: mpResponse.status }
      );

      return errorResponse(
        "mercadopago_result_uncertain",
        "Não foi possível confirmar o resultado do checkout. Não inicie outra assinatura; a tentativa precisa ser verificada.",
        502
      );
    }

    const mpData = (await mpResponse.json()) as {
      id?: string | number;
      init_point?: string;
      sandbox_init_point?: string;
      preapproval_plan_id?: string;
      external_reference?: string;
    };

    const preapprovalId =
      mpData.id !== undefined ? String(mpData.id) : "";

    const checkoutUrl =
      mpData.init_point || mpData.sandbox_init_point || "";

    if (
      !/^[A-Za-z0-9_-]+$/.test(preapprovalId) ||
      !checkoutUrl ||
      !isMercadoPagoCheckoutUrl(checkoutUrl) ||
      (
        mpData.external_reference &&
        mpData.external_reference !== attempt.external_reference
      ) ||
      (
        mpData.preapproval_plan_id &&
        mpData.preapproval_plan_id !== planId
      )
    ) {
      console.error(
        "[checkout] Resposta do Mercado Pago inválida ou inconsistente."
      );

      return errorResponse(
        "invalid_checkout_response",
        "Não foi possível validar a resposta do checkout. Não inicie outra assinatura.",
        502
      );
    }

    const { error: attemptSaveError } = await admin
      .from("subscription_checkout_attempts")
      .update({
        status: "pending",
        mp_preapproval_id: preapprovalId,
        checkout_url: checkoutUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .eq("status", "creating");

    if (attemptSaveError) {
      console.error(
        "[checkout] Falha ao salvar a tentativa do checkout."
      );

      return errorResponse(
        "checkout_persistence_failed",
        "O checkout pode ter sido criado, mas não foi possível confirmar seu registro. Não tente iniciar outra assinatura.",
        503
      );
    }

    const saved = await savePendingSubscription(
      admin,
      user.id,
      preapprovalId,
      planId
    );

    if (!saved) {
      return errorResponse(
        "subscription_persistence_failed",
        "O checkout foi registrado, mas a assinatura ainda precisa ser reconciliada. Não inicie outra tentativa.",
        503
      );
    }

    return NextResponse.json({ checkoutUrl });
  } catch {
    // Não apagamos nem recriamos uma reserva quando há timeout ou erro
    // de rede: o resultado no Mercado Pago pode ser desconhecido.
    console.error(
      "[subscription/checkout] Erro interno ao iniciar checkout."
    );

    return errorResponse(
      "server_error",
      "Não foi possível confirmar o resultado do checkout. Não inicie outra assinatura até verificar a tentativa existente.",
      500
    );
  }
}
