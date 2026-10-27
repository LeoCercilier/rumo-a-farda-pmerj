import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CHECKOUT_LEASE_MINUTES = 5;
const PREMIUM_PRICE = 19.9;
const PREMIUM_REASON = "Rumo à Farda Premium — Soldado PMERJ";

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

type MercadoPagoResource = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  init_point?: string;
  sandbox_init_point?: string;
  preapproval_plan_id?: string | null;
};

type SearchResult =
  | { kind: "found"; resource: MercadoPagoResource }
  | { kind: "none" }
  | { kind: "unknown" };

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

function isValidPreapprovalId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
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

  if (error) return { attempt: null, failed: true };

  return {
    attempt: data as CheckoutAttempt | null,
    failed: false,
  };
}

async function savePendingSubscription(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preapprovalId: string
): Promise<boolean> {
  const { data: existing, error: readError } = await admin
    .from("subscriptions")
    .select("status, mp_preapproval_id, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) return false;

  if (existing) {
    const current = existing as ExistingSubscription;

    if (
      current.mp_preapproval_id &&
      current.mp_preapproval_id !== preapprovalId
    ) {
      console.error("[checkout] Identificador de assinatura divergente.");
      return false;
    }

    if (hasPaidPeriod(current)) return false;

    if (current.status !== "pending") return false;
  }

  const { error } = await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        status: "pending",
        mp_preapproval_id: preapprovalId,
        plan_id: null,
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

async function searchByExternalReference(
  externalReference: string,
  accessToken: string
): Promise<SearchResult> {
  try {
    const url = new URL(
      "https://api.mercadopago.com/preapproval/search"
    );
    url.searchParams.set("external_reference", externalReference);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error("[checkout] Reconciliação remota indisponível.", {
        httpStatus: response.status,
      });
      return { kind: "unknown" };
    }

    const body = (await response.json()) as {
      results?: MercadoPagoResource[];
    };

    if (!Array.isArray(body.results)) {
      return { kind: "unknown" };
    }

    const matches = body.results.filter(
      (item) => item.external_reference === externalReference
    );

    if (matches.length === 0) return { kind: "none" };

    if (matches.length !== 1) {
      console.error("[checkout] Referência remota ambígua.");
      return { kind: "unknown" };
    }

    return { kind: "found", resource: matches[0] };
  } catch {
    console.error("[checkout] Falha na reconciliação remota.");
    return { kind: "unknown" };
  }
}

function getCheckoutDetails(
  resource: MercadoPagoResource,
  expectedReference: string
): { id: string; url: string | null } | null {
  const id = resource.id !== undefined ? String(resource.id) : "";
  const rawUrl = resource.init_point || resource.sandbox_init_point || "";
  const url = rawUrl || null;
  const status = (resource.status ?? "").toLowerCase();

  if (
    !isValidPreapprovalId(id) ||
    resource.external_reference !== expectedReference ||
    (url !== null && !isMercadoPagoCheckoutUrl(url)) ||
    (!url && status !== "authorized" && status !== "pending")
  ) {
    return null;
  }

  return { id, url };
}

async function persistCheckoutResult(
  admin: ReturnType<typeof createAdminClient>,
  attempt: CheckoutAttempt,
  resource: MercadoPagoResource
): Promise<{
  ok: boolean;
  checkoutUrl?: string;
  subscriptionCreated?: boolean;
}> {
  const details = getCheckoutDetails(resource, attempt.external_reference);

  if (!details) return { ok: false };

  const { data: savedAttempt, error: attemptError } = await admin
    .from("subscription_checkout_attempts")
    .update({
      status: "pending",
      mp_preapproval_id: details.id,
      checkout_url: details.url,
      updated_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .eq("status", "creating")
    .select("id")
    .maybeSingle();

  if (attemptError || !savedAttempt) {
    console.error("[checkout] Falha ao persistir tentativa reconciliada.");
    return { ok: false };
  }

  const savedSubscription = await savePendingSubscription(
    admin,
    attempt.user_id,
    details.id
  );

  if (!savedSubscription) {
    return { ok: false };
  }

  return details.url
    ? { ok: true, checkoutUrl: details.url }
    : { ok: true, subscriptionCreated: true };
}

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

async function getErrorDiagnostic(response: Response) {
  const diagnostic: {
    httpStatus: number;
    error?: string;
    message?: string;
    causeCodes?: Array<string | number>;
  } = { httpStatus: response.status };

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

      if (codes.length) diagnostic.causeCodes = codes;
    }
  } catch {
    // Registrar somente o status HTTP se o corpo não puder ser lido.
  }

  return diagnostic;
}

export async function POST(request: Request) {
  try {
    let cardTokenId: string;

    try {
      const body = (await request.json()) as {
        card_token_id?: unknown;
      };

      cardTokenId =
        typeof body.card_token_id === "string"
          ? body.card_token_id.trim()
          : "";
    } catch {
      return errorResponse(
        "invalid_request",
        "Não foi possível ler os dados do cartão. Preencha o formulário novamente.",
        400
      );
    }

    if (!/^[A-Za-z0-9_-]{10,500}$/.test(cardTokenId)) {
      return errorResponse(
        "card_token_required",
        "Preencha os dados do cartão para continuar.",
        422
      );
    }

    if (process.env.BILLING_ENABLED !== "true") {
      return errorResponse(
        "billing_disabled",
        "A assinatura está temporariamente indisponível.",
        503
      );
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const appUrl = getAppUrl();

    if (!accessToken || !appUrl) {
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
        "Sua conta já possui um período pago vigente.",
        409
      );
    }

    const read = await readAttempt(admin, user.id);

    if (read.failed) {
      return errorResponse(
        "checkout_attempt_unavailable",
        "Não foi possível verificar a tentativa anterior.",
        503
      );
    }

    let attempt: CheckoutAttempt;
    let ownsNewAttempt = false;

    if (read.attempt) {
      attempt = read.attempt;
    } else {
      if (subscription?.mp_preapproval_id) {
        return errorResponse(
          "subscription_reconciliation_required",
          "A assinatura anterior precisa ser reconciliada antes de iniciar outra tentativa.",
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
        "A tentativa anterior precisa ser reconciliada antes de continuar.",
        409
      );
    }

    if (attempt.status === "pending") {
      if (!attempt.mp_preapproval_id) {
        return errorResponse(
          "checkout_attempt_inconsistent",
          "A tentativa existente precisa ser verificada.",
          409
        );
      }

      if (
        attempt.checkout_url &&
        !isMercadoPagoCheckoutUrl(attempt.checkout_url)
      ) {
        return errorResponse(
          "checkout_attempt_inconsistent",
          "A tentativa existente precisa ser verificada.",
          409
        );
      }

      const saved = await savePendingSubscription(
        admin,
        user.id,
        attempt.mp_preapproval_id
      );

      if (!saved) {
        return errorResponse(
          "subscription_persistence_failed",
          "Não foi possível reconciliar o checkout com a assinatura existente.",
          409
        );
      }

      return attempt.checkout_url
        ? NextResponse.json({ checkoutUrl: attempt.checkout_url })
        : NextResponse.json({
            subscriptionCreated: true,
            message:
              "Assinatura registrada. Aguardando confirmação do Mercado Pago.",
          });
    }

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
          "A tentativa está sendo recuperada por outra requisição.",
          409
        );
      }

      attempt = claimed as CheckoutAttempt;

      // Consultar primeiro a referência antiga para não duplicar
      // uma assinatura que já possa existir no Mercado Pago.
      const reconciliation = await searchByExternalReference(
        attempt.external_reference,
        accessToken
      );

      if (reconciliation.kind === "unknown") {
        return errorResponse(
          "checkout_reconciliation_unavailable",
          "Não foi possível verificar a tentativa anterior. Nenhuma nova tentativa foi criada.",
          503
        );
      }

      if (reconciliation.kind === "found") {
        const resource = reconciliation.resource;
        const resourcePlan = resource.preapproval_plan_id ?? null;
        const configuredPlan = process.env.MERCADOPAGO_PLAN_ID;

        if (resourcePlan && resourcePlan !== configuredPlan) {
          return errorResponse(
            "checkout_reconciliation_required",
            "Foi encontrada uma assinatura associada a outro plano. É necessária uma verificação antes de continuar.",
            409
          );
        }

        const result = await persistCheckoutResult(
          admin,
          attempt,
          resource
        );

        if (!result.ok) {
          return errorResponse(
            "checkout_persistence_failed",
            "A assinatura encontrada precisa ser reconciliada antes de continuar.",
            503
          );
        }

        return result.checkoutUrl
          ? NextResponse.json({ checkoutUrl: result.checkoutUrl })
          : NextResponse.json({
              subscriptionCreated: true,
              message:
                "Assinatura registrada. Aguardando confirmação do Mercado Pago.",
            });
      }

      // A API não encontrou recurso para a referência anterior.
      // Uma nova chave e referência evitam reutilizar a mesma chave
      // de idempotência com dados diferentes.
      const newIdempotencyKey = randomUUID();
      const newExternalReference = `user:${user.id}:${randomUUID()}`;

      const { data: rotated, error: rotateError } = await admin
        .from("subscription_checkout_attempts")
        .update({
          idempotency_key: newIdempotencyKey,
          external_reference: newExternalReference,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id)
        .eq("status", "creating")
        .eq("idempotency_key", attempt.idempotency_key)
        .eq("external_reference", attempt.external_reference)
        .select(
          "id, user_id, idempotency_key, external_reference, status, mp_preapproval_id, checkout_url, lease_expires_at"
        )
        .maybeSingle();

      if (rotateError || !rotated) {
        return errorResponse(
          "checkout_reconciliation_required",
          "Não foi possível reservar uma nova referência com segurança.",
          409
        );
      }

      attempt = rotated as CheckoutAttempt;
    }

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
          reason: PREMIUM_REASON,
          external_reference: attempt.external_reference,
          payer_email: user.email,
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: PREMIUM_PRICE,
            currency_id: "BRL",
          },
          back_url: `${appUrl}/assinatura?retorno=ok`,
          card_token_id: cardTokenId,
          status: "authorized",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!mpResponse.ok) {
      const diagnostic = await getErrorDiagnostic(mpResponse);

      console.error(
        "[checkout] Resultado não confirmado pelo Mercado Pago.",
        diagnostic
      );

      return errorResponse(
        "mercadopago_result_uncertain",
        "Não foi possível confirmar o resultado. Não inicie outra tentativa enquanto ela não for reconciliada.",
        502
      );
    }

    const resource = (await mpResponse.json()) as MercadoPagoResource;

    if (
      resource.preapproval_plan_id &&
      resource.preapproval_plan_id !== process.env.MERCADOPAGO_PLAN_ID
    ) {
      console.error("[checkout] Resposta vinculada a plano inesperado.");

      return errorResponse(
        "invalid_checkout_response",
        "A resposta do checkout precisa ser reconciliada.",
        502
      );
    }

    const result = await persistCheckoutResult(
      admin,
      attempt,
      resource
    );

    if (!result.ok) {
      return errorResponse(
        "checkout_persistence_failed",
        "A assinatura pode ter sido criada, mas o registro não foi confirmado. Não inicie outra tentativa.",
        503
      );
    }

    return result.checkoutUrl
      ? NextResponse.json({ checkoutUrl: result.checkoutUrl })
      : NextResponse.json({
          subscriptionCreated: true,
          message:
            "Assinatura registrada. Aguardando confirmação do Mercado Pago.",
        });
  } catch {
    console.error("[subscription/checkout] Erro interno.");

    return errorResponse(
      "server_error",
      "Não foi possível confirmar o resultado. Verifique a tentativa existente antes de tentar novamente.",
      500
    );
  }
}
