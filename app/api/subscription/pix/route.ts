
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PRICE = 19.90;
const PRICE_CENTS = 1990;
const CURRENCY = "BRL";
const DESCRIPTION = "Rumo à Farda Premium — Soldado PMERJ";

function fail(error: string, message: string, status: number) {
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
    ) return null;

    return url.origin;
  } catch {
    return null;
  }
}

function amountInCents(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

export async function POST() {
  try {
    if (process.env.BILLING_ENABLED !== "true") {
      return fail("billing_disabled", "Pagamento temporariamente indisponível.", 503);
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const appUrl = getAppUrl();

    if (!accessToken || !appUrl) {
      return fail("billing_not_configured", "Pagamento não configurado.", 503);
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } =
      await supabase.auth.getUser();

    if (authError || !user) {
      return fail("unauthenticated", "Faça login para continuar.", 401);
    }

    if (!user.email) {
      return fail("email_required", "Sua conta precisa ter um e-mail válido.", 422);
    }

    const admin = createAdminClient();

    // Reutiliza uma cobrança pendente para evitar duplicidade.
    const { data: existing, error: lookupError } = await admin
      .from("pix_payments")
      .select("id, mp_payment_id, status, qr_code, qr_code_base64, ticket_url, expires_at")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (lookupError) {
      return fail("payment_lookup_failed", "Não foi possível verificar pagamentos anteriores.", 503);
    }

    if (existing) {
      if (existing.qr_code && existing.mp_payment_id) {
        return NextResponse.json({
          paymentId: existing.mp_payment_id,
          status: existing.status,
          qrCode: existing.qr_code,
          qrCodeBase64: existing.qr_code_base64,
          ticketUrl: existing.ticket_url,
          expiresAt: existing.expires_at,
        });
      }

      return fail(
        "payment_reconciliation_required",
        "Existe uma cobrança em processamento. Aguarde a verificação antes de tentar novamente.",
        409
      );
    }

    const externalReference = `pix:${user.id}:${randomUUID()}`;
    const idempotencyKey = randomUUID();

    const expiration = new Date(Date.now() + 30 * 60 * 1000);

    const { data: paymentRecord, error: insertError } = await admin
      .from("pix_payments")
      .insert({
        user_id: user.id,
        external_reference: externalReference,
        idempotency_key: idempotencyKey,
        amount: PRICE,
        currency: CURRENCY,
        status: "pending",
        expires_at: expiration.toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !paymentRecord) {
      return fail(
        "payment_reservation_failed",
        "Não foi possível reservar a cobrança. Atualize a página e tente novamente.",
        503
      );
    }

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: PRICE,
        description: DESCRIPTION,
        payment_method_id: "pix",
        payer: {
          email: user.email,
        },
        external_reference: externalReference,
        date_of_expiration: expiration.toISOString(),
        notification_url: `${appUrl}/api/webhooks/mercadopago-pix`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error("[pix] Mercado Pago recusou ou não confirmou a cobrança.", {
        httpStatus: response.status,
      });

      // Mantém a reserva pendente: não cria outra cobrança
      // enquanto o resultado remoto não for reconciliado.
      return fail(
        "mercadopago_result_uncertain",
        "Não foi possível confirmar a criação do Pix. Aguarde a verificação antes de tentar novamente.",
        502
      );
    }

    const payment = await response.json();

    const paymentId = String(payment.id ?? "");
    const transactionData = payment.point_of_interaction?.transaction_data;
    const qrCode = transactionData?.qr_code;
    const qrCodeBase64 = transactionData?.qr_code_base64;
    const ticketUrl = transactionData?.ticket_url;

    const valid =
      /^[0-9]+$/.test(paymentId) &&
      payment.external_reference === externalReference &&
      payment.payment_method_id === "pix" &&
      payment.currency_id === CURRENCY &&
      amountInCents(payment.transaction_amount) === PRICE_CENTS &&
      payment.status === "pending" &&
      typeof qrCode === "string" &&
      qrCode.length > 0;

    if (!valid) {
      console.error("[pix] Resposta do pagamento não passou na validação.");
      return fail(
        "invalid_payment_response",
        "A cobrança precisa ser verificada antes de ser apresentada.",
        502
      );
    }

    const { data: saved, error: saveError } = await admin
      .from("pix_payments")
      .update({
        mp_payment_id: paymentId,
        qr_code: qrCode,
        qr_code_base64:
          typeof qrCodeBase64 === "string" ? qrCodeBase64 : null,
        ticket_url:
          typeof ticketUrl === "string" ? ticketUrl : null,
        expires_at: payment.date_of_expiration ?? expiration.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentRecord.id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (saveError || !saved) {
      console.error("[pix] Não foi possível salvar os dados da cobrança.");
      return fail(
        "payment_persistence_failed",
        "O Pix foi criado, mas precisa ser reconciliado antes de ser exibido.",
        503
      );
    }

    return NextResponse.json({
      paymentId,
      status: "pending",
      qrCode,
      qrCodeBase64: qrCodeBase64 ?? null,
      ticketUrl: ticketUrl ?? null,
      expiresAt: payment.date_of_expiration ?? expiration.toISOString(),
    });
  } catch {
    console.error("[subscription/pix] Erro interno.");
    return fail(
      "server_error",
      "Não foi possível iniciar o pagamento Pix.",
      500
    );
  }
}
