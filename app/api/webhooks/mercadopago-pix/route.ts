
import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PRICE_CENTS = 1990;
const CURRENCY = "BRL";
const SIGNATURE_TOLERANCE_SECONDS = 300;

type MercadoPagoPayment = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  payment_method_id?: string;
  currency_id?: string;
  transaction_amount?: number | string;
  date_approved?: string;
};

type PixRecord = {
  id: string;
  user_id: string;
  external_reference: string;
  mp_payment_id: string | null;
  amount: number | string;
  currency: string;
  status: string;
};

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function amountInCents(value: unknown): number | null {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function verifySignature(
  signature: string | null,
  requestId: string | null,
  dataId: string | null,
  secret: string
): boolean {
  if (!signature || !requestId || !dataId) {
    return false;
  }

  const parts: Record<string, string> = {};

  for (const part of signature.split(",")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    parts[part.slice(0, separator).trim()] =
      part.slice(separator + 1).trim();
  }

  const timestamp = parts.ts;
  const receivedHash = parts.v1;

  if (
    !timestamp ||
    !receivedHash ||
    !/^\d+$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/i.test(receivedHash)
  ) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) >
      SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const manifest =
    `id:${dataId};request-id:${requestId};ts:${timestamp};`;

  const expectedHash = createHmac("sha256", secret)
    .update(manifest)
    .digest();

  const receivedBuffer = Buffer.from(receivedHash, "hex");

  return (
    receivedBuffer.length === expectedHash.length &&
    timingSafeEqual(receivedBuffer, expectedHash)
  );
}

async function getPayment(
  paymentId: string,
  accessToken: string
): Promise<MercadoPagoPayment | null> {
  try {
    const result = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!result.ok) {
      console.error("[pix-webhook] Consulta do pagamento falhou.", {
        httpStatus: result.status,
      });

      return null;
    }

    return (await result.json()) as MercadoPagoPayment;
  } catch {
    console.error("[pix-webhook] Erro ao consultar pagamento.");
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

    if (!secret || !accessToken) {
      return response("webhook_not_configured", 503);
    }

    const url = new URL(request.url);
    const paymentId = url.searchParams.get("data.id");
    const requestId = request.headers.get("x-request-id");
    const signature = request.headers.get("x-signature");

    if (
      !paymentId ||
      !/^\d+$/.test(paymentId) ||
      !verifySignature(signature, requestId, paymentId, secret)
    ) {
      return response("invalid_signature", 401);
    }

    let body: {
      type?: string;
      action?: string;
      data?: { id?: string | number };
    };

    try {
      body = await request.json();
    } catch {
      return response("invalid_body", 400);
    }

    if (
      body.data?.id !== undefined &&
      String(body.data.id) !== paymentId
    ) {
      return response("resource_id_mismatch", 400);
    }

    if (
      body.type &&
      body.type !== "payment"
    ) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "unsupported_event",
      });
    }

    // O conteúdo recebido na notificação não é usado como
    // confirmação. O pagamento é consultado diretamente no MP.
    const payment = await getPayment(paymentId, accessToken);

    if (!payment || String(payment.id) !== paymentId) {
      return response("payment_lookup_failed", 503);
    }

    const externalReference = payment.external_reference;

    if (
      !externalReference ||
      !/^pix:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        externalReference
      )
    ) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "not_a_pix_subscription",
      });
    }

    // Confere os dados comerciais consultados no Mercado Pago.
    if (
      payment.payment_method_id !== "pix" ||
      payment.currency_id !== CURRENCY ||
      amountInCents(payment.transaction_amount) !== PRICE_CENTS
    ) {
      console.error("[pix-webhook] Dados comerciais incompatíveis.", {
        paymentId,
      });

      return NextResponse.json({
        received: true,
        processed: false,
        reason: "payment_validation_failed",
      });
    }

    const admin = createAdminClient();

    const { data: record, error: lookupError } = await admin
      .from("pix_payments")
      .select(
        "id, user_id, external_reference, mp_payment_id, amount, currency, status"
      )
      .eq("external_reference", externalReference)
      .maybeSingle();

    if (lookupError) {
      return response("payment_record_lookup_failed", 503);
    }

    if (!record) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "payment_record_not_found",
      });
    }

    const pix = record as PixRecord;

    if (
      externalReference !== pix.external_reference ||
      !externalReference.startsWith(`pix:${pix.user_id}:`) ||
      amountInCents(pix.amount) !== PRICE_CENTS ||
      pix.currency !== CURRENCY
    ) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "database_validation_failed",
      });
    }

    if (
      pix.mp_payment_id &&
      pix.mp_payment_id !== paymentId
    ) {
      console.error("[pix-webhook] ID de pagamento divergente.", {
        paymentId,
      });

      return NextResponse.json({
        received: true,
        processed: false,
        reason: "payment_id_mismatch",
      });
    }

    // A notificação pode chegar antes de a rota de criação
    // terminar de salvar o ID do pagamento. Vincula o ID aqui.
    if (!pix.mp_payment_id) {
      const { error: linkError } = await admin
        .from("pix_payments")
        .update({
          mp_payment_id: paymentId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pix.id)
        .eq("external_reference", externalReference)
        .is("mp_payment_id", null);

      if (linkError) {
        return response("payment_link_failed", 503);
      }

      const { data: confirmed, error: confirmError } = await admin
        .from("pix_payments")
        .select("mp_payment_id")
        .eq("id", pix.id)
        .maybeSingle();

      if (
        confirmError ||
        confirmed?.mp_payment_id !== paymentId
      ) {
        return response("payment_link_verification_failed", 503);
      }
    }

    const status = (payment.status ?? "").toLowerCase();

    // Estados intermediários não liberam Premium.
    // Em análise de disputa, aguardamos o desfecho.
    if (
      status === "pending" ||
      status === "authorized" ||
      status === "in_process" ||
      status === "in_mediation"
    ) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "payment_not_final",
      });
    }

    const allowedStatuses = [
      "approved",
      "refunded",
      "charged_back",
      "rejected",
      "cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "unsupported_payment_status",
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
      console.error("[pix-webhook] Falha ao finalizar pagamento.", {
        paymentId,
        code: finalizeError.code,
      });

      return response("payment_finalization_failed", 503);
    }

    return NextResponse.json({
      received: true,
      processed: Boolean(finalized),
      paymentStatus: status,
    });
  } catch {
    console.error("[pix-webhook] Erro interno no processamento.");
    return response("webhook_processing_failed", 503);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Mercado Pago Pix — use POST para notificações.",
  });
}
