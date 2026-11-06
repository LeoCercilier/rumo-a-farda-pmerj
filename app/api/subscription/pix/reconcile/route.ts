
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PRICE_CENTS = 1990;
const CURRENCY = "BRL";

type MercadoPagoPayment = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  payment_method_id?: string;
  currency_id?: string;
  transaction_amount?: number | string;
  date_approved?: string;
};

function amountInCents(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  try {
    if (process.env.BILLING_ENABLED !== "true") {
      return fail("billing_disabled", 503);
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!accessToken) {
      return fail("billing_not_configured", 503);
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return fail("unauthenticated", 401);
    }

    let body: { paymentId?: string };

    try {
      body = await request.json();
    } catch {
      return fail("invalid_body", 400);
    }

    const paymentId = body.paymentId?.trim();

    if (!paymentId || !/^\d+$/.test(paymentId)) {
      return fail("invalid_payment_id", 400);
    }

    const admin = createAdminClient();

    const { data: record, error: lookupError } = await admin
      .from("pix_payments")
      .select(
        "id, user_id, external_reference, mp_payment_id, amount, currency, status"
      )
      .eq("user_id", user.id)
      .eq("mp_payment_id", paymentId)
      .eq("status", "pending")
      .maybeSingle();

    if (lookupError) {
      return fail("payment_lookup_failed", 503);
    }

    if (!record) {
      return NextResponse.json({
        processed: false,
        reason: "no_pending_pix",
      });
    }

    if (
      record.user_id !== user.id ||
      !record.external_reference.startsWith(`pix:${user.id}:`) ||
      amountInCents(record.amount) !== PRICE_CENTS ||
      record.currency !== CURRENCY
    ) {
      return fail("database_validation_failed", 409);
    }

    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      return fail("payment_lookup_failed", 503);
    }

    const payment =
      (await response.json()) as MercadoPagoPayment;

    if (
      String(payment.id) !== paymentId ||
      payment.external_reference !== record.external_reference ||
      payment.payment_method_id !== "pix" ||
      payment.currency_id !== CURRENCY ||
      amountInCents(payment.transaction_amount) !== PRICE_CENTS
    ) {
      return fail("payment_validation_failed", 409);
    }

    const status = (payment.status ?? "").toLowerCase();

    const allowedStatuses = [
      "approved",
      "refunded",
      "charged_back",
      "rejected",
      "cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return NextResponse.json({
        processed: false,
        reason: "payment_not_final",
        paymentStatus: status || "unknown",
      });
    }

    const { data: finalized, error: finalizeError } =
      await admin.rpc("finalize_pix_payment", {
        p_mp_payment_id: paymentId,
        p_target_status: status,
        p_paid_at:
          status === "approved"
            ? payment.date_approved ?? new Date().toISOString()
            : null,
      });

    if (finalizeError) {
      console.error("[pix-reconcile] Falha ao finalizar pagamento.", {
        code: finalizeError.code,
      });

      return fail("payment_finalization_failed", 503);
    }

    return NextResponse.json({
      processed: Boolean(finalized),
      paymentStatus: status,
    });
  } catch {
    console.error("[pix-reconcile] Erro interno.");
    return fail("reconciliation_failed", 503);
  }
}
