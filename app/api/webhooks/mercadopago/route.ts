
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type WebhookBody = {
  type?: string;
  action?: string;
  data?: {
    id?: string | number;
  };
};

type MercadoPagoSubscription = {
  id?: string;
  status?: string;
  external_reference?: string;
  preapproval_plan_id?: string;
  next_payment_date?: string;
};

type AuthorizedPayment = {
  id?: string | number;
  preapproval_id?: string;
  status?: string;
  payment?: {
    id?: string | number;
    status?: string;
    status_detail?: string;
  };
};

const SIGNATURE_TOLERANCE_SECONDS = 300;

function verifySignature(
  signature: string | null,
  requestId: string | null,
  dataId: string | null,
  secret: string
): boolean {
  if (!signature || !requestId || !dataId) return false;

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

function getUserId(reference: string | undefined): string | null {
  const match = reference?.match(
    /^user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );

  return match?.[1] ?? null;
}

async function getMercadoPagoResource<T>(
  path: string,
  accessToken: string
): Promise<T | null> {
  const response = await fetch(
    `https://api.mercadopago.com${path}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    console.error("[webhook] Falha ao consultar recurso do Mercado Pago.", {
      httpStatus: response.status,
    });
    return null;
  }

  return (await response.json()) as T;
}

export async function POST(request: Request) {
  try {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const expectedPlanId = process.env.MERCADOPAGO_PLAN_ID;

    if (!secret || !accessToken || !expectedPlanId) {
      return NextResponse.json(
        { error: "webhook_not_configured" },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id");
    const requestId = request.headers.get("x-request-id");
    const signature = request.headers.get("x-signature");

    if (
      !dataId ||
      !/^\d+$/.test(dataId) ||
      !verifySignature(signature, requestId, dataId, secret)
    ) {
      return NextResponse.json(
        { error: "invalid_signature" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as WebhookBody;

    if (
      body.data?.id !== undefined &&
      String(body.data.id) !== dataId
    ) {
      return NextResponse.json(
        { error: "resource_id_mismatch" },
        { status: 400 }
      );
    }

    const isSubscriptionEvent =
      body.type === "subscription_preapproval" ||
      body.action?.includes("subscription_preapproval") === true;

    const isInvoiceEvent =
      body.type === "subscription_authorized_payment" ||
      body.action?.includes("subscription_authorized_payment") === true;

    if (!isSubscriptionEvent && !isInvoiceEvent) {
      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    let preapprovalId: string | null = null;
    let paymentApproved = false;

    if (isInvoiceEvent) {
      const invoice = await getMercadoPagoResource<AuthorizedPayment>(
        `/authorized_payments/${encodeURIComponent(dataId)}`,
        accessToken
      );

      if (!invoice || String(invoice.id) !== dataId) {
        return NextResponse.json(
          { error: "invoice_lookup_failed" },
          { status: 502 }
        );
      }

      preapprovalId = invoice.preapproval_id ?? null;
      paymentApproved = invoice.payment?.status === "approved";

      // Cobranças pendentes ou recusadas nunca ativam o Premium.
      // O tratamento completo de falhas recorrentes exige reconciliação
      // específica e não é feito por este caminho.
      if (!paymentApproved) {
        return NextResponse.json({
          received: true,
          processed: false,
        });
      }
    } else {
      preapprovalId = dataId;
    }

    if (!preapprovalId || !/^\d+$/.test(preapprovalId)) {
      return NextResponse.json(
        { error: "invalid_preapproval_id" },
        { status: 400 }
      );
    }

    const resource = await getMercadoPagoResource<MercadoPagoSubscription>(
      `/preapproval/${encodeURIComponent(preapprovalId)}`,
      accessToken
    );

    if (!resource || resource.id !== preapprovalId) {
      return NextResponse.json(
        { error: "subscription_lookup_failed" },
        { status: 502 }
      );
    }

    if (resource.preapproval_plan_id !== expectedPlanId) {
      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    const userId = getUserId(resource.external_reference);

    if (!userId) {
      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    const admin = createAdminClient();

    const { data: existing, error: existingError } = await admin
      .from("subscriptions")
      .select("status, current_period_end, mp_preapproval_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      console.error("[webhook] Falha ao consultar assinatura local.");
      return NextResponse.json(
        { error: "subscription_check_failed" },
        { status: 500 }
      );
    }

    // Impede que uma notificação de outra assinatura substitua
    // silenciosamente a assinatura já associada a este usuário.
    if (
      existing?.mp_preapproval_id &&
      existing.mp_preapproval_id !== preapprovalId
    ) {
      console.warn("[webhook] Identificador de assinatura divergente.");
      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const nextPaymentMs = resource.next_payment_date
      ? Date.parse(resource.next_payment_date)
      : Number.NaN;

    const nextPaymentIsFuture =
      Number.isFinite(nextPaymentMs) &&
      nextPaymentMs > now.getTime();

    let status:
      | "active"
      | "pending"
      | "cancelled"
      | "past_due"
      | "rejected"
      | "expired" = "pending";

    let periodEnd: string | null = null;
    let cancelledAt: string | null = null;

    switch ((resource.status ?? "").toLowerCase()) {
      case "cancelled":
      case "canceled":
        status = "cancelled";
        cancelledAt = nowIso;
        break;

      case "paused":
        status = "past_due";
        break;

      case "rejected":
        status = "rejected";
        break;

      case "expired":
        status = "expired";
        break;

      case "authorized":
        if (paymentApproved && nextPaymentIsFuture) {
          status = "active";
          periodEnd = new Date(nextPaymentMs).toISOString();
        } else {
          // Não conceder acesso novo sem uma cobrança confirmada.
          // Preservar o período já validado evita que uma notificação
          // comum da assinatura corte acesso pago prematuramente.
          const oldEnd = existing?.current_period_end
            ? Date.parse(existing.current_period_end)
            : Number.NaN;

          if (
            existing?.status === "active" &&
            Number.isFinite(oldEnd) &&
            oldEnd > now.getTime()
          ) {
            status = "active";
            periodEnd = new Date(oldEnd).toISOString();
          }
        }
        break;

      default:
        status = "pending";
    }

    // Uma cobrança aprovada sem data futura confiável não libera acesso.
    if (
      paymentApproved &&
      resource.status?.toLowerCase() === "authorized" &&
      !nextPaymentIsFuture
    ) {
      status = "pending";
      periodEnd = null;
    }

    const { error: saveError } = await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          status,
          mp_preapproval_id: preapprovalId,
          plan_id: resource.preapproval_plan_id,
          current_period_end: periodEnd,
          cancelled_at: cancelledAt,
          raw_payload: {
            subscription: resource,
            notification_type: body.type ?? null,
            notification_action: body.action ?? null,
            invoice_id: isInvoiceEvent ? dataId : null,
            payment_approved: paymentApproved,
          },
          updated_at: nowIso,
        },
        { onConflict: "user_id" }
      );

    if (saveError) {
      console.error("[webhook] Falha ao persistir assinatura.");
      return NextResponse.json(
        { error: "subscription_persistence_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      received: true,
      processed: true,
    });
  } catch {
    console.error("[webhook] Erro interno ao processar notificação.");
    return NextResponse.json(
      { error: "server_error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Mercado Pago — use POST para notificações.",
  });
}
