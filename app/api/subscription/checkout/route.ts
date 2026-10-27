
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

type ExistingSubscription = {
  status: string;
  mp_preapproval_id: string | null;
  current_period_end: string | null;
};

function errorResponse(error: string, message: string, status: number) {
  return NextResponse.json({ error, message }, { status });
}

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

function hasPaidPeriod(subscription: ExistingSubscription): boolean {
  if (
    subscription.status !== "active" &&
    subscription.status !== "cancelled"
  ) {
    return false;
  }

  if (!subscription.current_period_end) return false;

  const end = Date.parse(subscription.current_period_end);
  return Number.isFinite(end) && end > Date.now();
}

async function savePendingSubscription(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preapprovalId: string,
  planId: string
): Promise<boolean> {
  const { data: existing, error: readError } = await admin
    .from("subscriptions")
    .select("status, mp_preapproval_id, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) return false;

  if (existing) {
    const current = existing as ExistingSubscription;

    // Nunca substituir uma assinatura com outro identificador.
    if (
      current.mp_preapproval_id &&
      current.mp_preapproval_id !== preapprovalId
    ) {
      console.error("[checkout] Identificador de assinatura divergente.");
      return false;
    }

    // Não sobrescrever uma assinatura com período pago vigente.
    if (hasPaidPeriod(current)) {
      return false;
    }

    // Só reutilizar uma linha existente se ela estiver pendente.
    // Estados terminais exigem reconciliação antes de substituição.
    if (current.status !== "pending") {
      return false;
    }
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
    console.error("[checkout] Falha ao persistir assinatura pendente.");
    return false;
  }

  return true;
}

async function readAttempt(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<{ attempt: CheckoutAttempt | null; failed: boolean }> {
  const { data, error } = await admin
    .from("subscription_checkout_attempts")
    .select(
      "id, user_id, idempotency_key, external_reference, status, mp_preapproval_id, checkout_url, lease_expires_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { attempt: null, failed: true };
  }

  return {
    attempt: data as CheckoutAttempt | null,
    failed: false,
  };
}

/**
 * Diagnóstico restrito da resposta de erro do Mercado Pago.
 * Nunca registra o corpo completo nem dados da requisição.
 */
function sanitizeDiagnosticText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") return undefined;

  const sanitized = value
    .replace(/Bearer\s+\S+/gi, "[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[EMAIL]")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,
      "[ID]"
    )
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, maxLength);

  return sanitized || undefined;
}

async function getMercadoPagoErrorDiagnostic(
  response: Response
): Promise<{
  httpStatus: number;
  error?: string;
  message?: string;
  causeCodes?: Array<string | number>;
}> {
  const diagnostic: {
    httpStatus: number;
    error?: string;
    message?: string;
    causeCodes?: Array<string | number>;
  } = {
    httpStatus: response.status,
  };

  try {
    const body: unknown = await response.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return diagnostic;
    }

    const data = body as Record<string, unknown>;

    const error = sanitizeDiagnosticText(data.error, 100);
    const message = sanitizeDiagnosticText(data.message, 200);

    if (error) diagnostic.error = error;
    if (message) diagnostic.message = message;

    if (Array.isArray(data.cause)) {
      const codes: Array<string | number> = [];

      for (const item of data.cause.slice(0, 5)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const code = (item as Record<string, unknown>).code;

        if (typeof code === "number" && Number.isFinite(code)) {
          codes.push(code);
        } else if (
          typeof code === "string" &&
          /^[A-Za-z0-9_.-]{1,60}$/.test(code)
        ) {
          codes.push(code);
        }
      }

      if (codes.length > 0) {
        diagnostic.causeCodes = codes;
      }
    }
  } catch {
    // Corpo ausente, não JSON ou ilegível:
    // manter apenas o status HTTP.
  }

  return diagnostic;
}

export async function POST() {
  try {
    // Não habilitar cobranças sem autorização expressa.
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
      return errorResponse("unauthenticated", "Faça login para assinar.", 401);
    }

    if (!user.email) {
      return errorResponse(
        "email_required",
        "Sua conta precisa ter um e-mail válido para iniciar a assinatura.",
        422
      );
    }

    const admin = createAdminClient();

    const { data: subscriptionData, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("status, mp_preapproval_id, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subscriptionError) {
      return errorResponse(
        "subscription_check_failed",
        "Não foi possível verificar sua assinatura. Tente novamente mais tarde.",
        503
      );
    }

    const subscription = subscriptionData as ExistingSubscription | null;

    if (subscription && hasPaidPeriod(subscription)) {
      return errorResponse(
        "subscription_period_still_valid",
        "Sua conta já possui um período pago vigente. Não é necessário iniciar outra assinatura.",
        409
      );
    }

    let attempt: CheckoutAttempt;
    let ownsNewAttempt = false;

    // Procurar uma tentativa existente antes de criar outra.
    const read = await readAttempt(admin, user.id);

    if (read.failed) {
      return errorResponse(
        "checkout_attempt_unavailable",
        "Não foi possível verificar a tentativa anterior.",
        503
      );
    }

    if (read.attempt) {
      attempt = read.attempt;
    } else {
      // Não iniciar outro identificador de cobrança quando existe
      // uma assinatura antiga que ainda exige reconciliação.
      if (subscription?.mp_preapproval_id) {
        return errorResponse(
          "subscription_reconciliation_required",
          "A assinatura anterior precisa ser reconciliada antes de iniciar outra cobrança.",
          409
        );
      }

      const now = new Date();
      const leaseExpiresAt = new Date(
        now.getTime() + CHECKOUT_LEASE_MINUTES * 60 * 1000
      ).toISOString();

      const { data: inserted, error: insertError } = await admin
        .from("subscription_checkout_attempts")
        .insert({
          user_id: user.id,
          idempotency_key: randomUUID(),
          external_reference: `user:${user.id}:${randomUUID()}`,
          status: "creating",
          lease_expires_at: leaseExpiresAt,
        })
        .select(
          "id, user_id, idempotency_key, external_reference, status, mp_preapproval_id, checkout_url, lease_expires_at"
        )
        .maybeSingle();

      if (insertError || !inserted) {
        // Outra requisição pode ter reservado a tentativa nesse intervalo.
        const reread = await readAttempt(admin, user.id);

        if (reread.failed || !reread.attempt) {
          return errorResponse(
            "checkout_attempt_unavailable",
            "Não foi possível reservar a tentativa de checkout.",
            503
          );
        }

        attempt = reread.attempt;
      } else {
        attempt = inserted as CheckoutAttempt;
        ownsNewAttempt = true;
      }
    }

    if (attempt.status === "failed") {
      return errorResponse(
        "checkout_attempt_requires_review",
        "A tentativa anterior precisa ser reconciliada antes de iniciar outra cobrança.",
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
          "Não foi possível reconciliar o checkout com a assinatura existente.",
          409
        );
      }

      return NextResponse.json({ checkoutUrl: attempt.checkout_url });
    }

    // Uma tentativa creating que não foi criada nesta requisição
    // só pode ser retomada após expirar sua reserva.
    if (!ownsNewAttempt) {
      if (Date.parse(attempt.lease_expires_at) > Date.now()) {
        return errorResponse(
          "checkout_in_progress",
          "Já existe uma tentativa em andamento. Aguarde antes de tentar novamente.",
          409
        );
      }

      const newLeaseExpiresAt = new Date(
        Date.now() + CHECKOUT_LEASE_MINUTES * 60 * 1000
      ).toISOString();

      // Atualização condicional: apenas uma requisição pode reivindicar
      // uma reserva expirada. A chave de idempotência original é mantida.
      const { data: claimed, error: claimError } = await admin
        .from("subscription_checkout_attempts")
        .update({
          lease_expires_at: newLeaseExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id)
        .eq("status", "creating")
        .lte("lease_expires_at", new Date().toISOString())
        .select(
          "id, user_id, idempotency_key, external_reference, status, mp_preapproval_id, checkout_url, lease_expires_at"
        )
        .maybeSingle();

      if (claimError || !claimed) {
        return errorResponse(
          "checkout_reconciliation_required",
          "Outra requisição pode estar recuperando essa tentativa. Verifique o status antes de continuar.",
          409
        );
      }

      attempt = claimed as CheckoutAttempt;
    }

    // Se já há um identificador na assinatura, ele precisa coincidir
    // com a tentativa que está sendo retomada.
    if (
      subscription?.mp_preapproval_id &&
      subscription.mp_preapproval_id !== attempt.mp_preapproval_id
    ) {
      return errorResponse(
        "subscription_reconciliation_required",
        "A assinatura anterior precisa ser reconciliada antes de continuar.",
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
      // A resposta pode indicar falha, mas o resultado da tentativa
      // continua sujeito à reconciliação. Não criar outra chave.
      const diagnostic = await getMercadoPagoErrorDiagnostic(mpResponse);

      console.error(
        "[checkout] Resultado não confirmado pelo Mercado Pago.",
        diagnostic
      );

      return errorResponse(
        "mercadopago_result_uncertain",
        "Não foi possível confirmar o resultado. Aguarde a liberação da tentativa e não inicie outra cobrança.",
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
        mpData.external_reference !== undefined &&
        mpData.external_reference !== attempt.external_reference
      ) ||
      (
        mpData.preapproval_plan_id !== undefined &&
        mpData.preapproval_plan_id !== planId
      )
    ) {
      console.error("[checkout] Resposta inválida ou inconsistente.");

      return errorResponse(
        "invalid_checkout_response",
        "A resposta do checkout não pôde ser validada. A tentativa precisa ser reconciliada.",
        502
      );
    }

    // Só declarar a tentativa pendente se a atualização condicional
    // tiver realmente encontrado e atualizado a reserva.
    const { data: attemptSaved, error: attemptSaveError } = await admin
      .from("subscription_checkout_attempts")
      .update({
        status: "pending",
        mp_preapproval_id: preapprovalId,
        checkout_url: checkoutUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attempt.id)
      .eq("status", "creating")
      .select("id")
      .maybeSingle();

    if (attemptSaveError || !attemptSaved) {
      console.error("[checkout] Não foi possível confirmar o registro da tentativa.");

      return errorResponse(
        "checkout_persistence_failed",
        "O checkout pode ter sido criado, mas seu registro não foi confirmado. Não inicie outra tentativa.",
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
        "O checkout foi registrado, mas a assinatura precisa ser reconciliada. Não inicie outra tentativa.",
        503
      );
    }

    return NextResponse.json({ checkoutUrl });
  } catch {
    console.error("[subscription/checkout] Erro interno.");

    return errorResponse(
      "server_error",
      "Não foi possível confirmar o resultado. Verifique a tentativa existente antes de tentar novamente.",
      500
    );
  }
}
