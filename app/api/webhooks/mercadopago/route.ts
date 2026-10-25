
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
  last_modified?: string;
};

function verifySignature(
  signature: string | null,
  requestId: string | null,
  dataId: string | null,
  secret: string
): boolean {
  if (!signature || !requestId || !dataId) {
    return false;
  }

  const parts = Object.fromEntries(
    signature.split(",").map((part) => {
      const separator = part.indexOf("=");

      return separator === -1
        ? [part.trim(), ""]
        : [
            part.slice(0, separator).trim(),
            part.slice(separator + 1).trim(),
          ];
    })
  );

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

function mapStatus(
  status: string | undefined
): "active" | "pending" | "cancelled" | "past_due" | "rejected" | "expired" {
  switch ((status || "").toLowerCase()) {
    case "authorized":
      return "active";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "paused":
      return "past_due";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
    case "pending":
    default:
      return "pending";
  }
}

export async function POST(request: Request) {
  try {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const expectedPlanId = process.env.MERCADOPAGO_PLAN_ID;

    // Sem segredo configurado, o webhook não pode liberar acesso.
    if (!secret || !accessToken || !expectedPlanId) {
      console.error(
        "[webhook] Configuração do Mercado Pago incompleta."
      );

      return NextResponse.json(
        { error: "webhook_not_configured" },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id");
    const requestId = request.headers.get("x-request-id");
    const signature = request.headers.get("x-signature");

    if (!verifySignature(signature, requestId, dataId, secret)) {
      return NextResponse.json(
        { error: "invalid_signature" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as WebhookBody;

    const isSubscriptionEvent =
      body.type === "subscription_preapproval" ||
      body.action?.includes("subscription_preapproval");

    if (!isSubscriptionEvent) {
      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    if (!dataId || !/^\d+$/.test(dataId)) {
      return NextResponse.json(
        { error: "invalid_resource_id" },
        { status: 400 }
      );
    }

    // A assinatura digital é validada antes de consultar o recurso.
    // O status usado abaixo vem da API do Mercado Pago, não do navegador.
    const mpResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      }
    );

    if (!mpResponse.ok) {
      console.error(
        "[webhook] Falha ao consultar assinatura no Mercado Pago.",
        { httpStatus: mpResponse.status }
      );

      return NextResponse.json(
        { error: "subscription_lookup_failed" },
        { status: 502 }
      );
    }

    const resource =
      (await mpResponse.json()) as MercadoPagoSubscription;

    if (!resource.id || resource.id !== dataId) {
      return NextResponse.json(
        { error: "subscription_id_mismatch" },
        { status: 400 }
      );
    }

    // Não aceitar assinatura vinculada a outro plano.
    if (resource.preapproval_plan_id !== expectedPlanId) {
      console.warn(
        "[webhook] Plano da assinatura não corresponde ao plano configurado."
      );

      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    // A referência foi criada no checkout para identificar a conta.
    const userMatch = resource.external_reference?.match(
      /^user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const userId = userMatch?.[1];

    if (!userId) {
      console.warn(
        "[webhook] Referência externa inválida."
      );

      return NextResponse.json({
        received: true,
        processed: false,
      });
    }

    let status = mapStatus(resource.status);
    let periodEnd: string | null = null;

    if (status === "active") {
      const nextPaymentDate = resource.next_payment_date;
      const parsedDate = nextPaymentDate
        ? Date.parse(nextPaymentDate)
        : Number.NaN;

      // Não inventar vencimento: sem data válida e futura,
      // a assinatura permanece sem acesso Premium.
      if (
        Number.isNaN(parsedDate) ||
        parsedDate <= Date.now()
      ) {
        status = "pending";
      } else {
        periodEnd = new Date(parsedDate).toISOString();
      }
    }

    const now = new Date().toISOString();
    const admin = createAdminClient();

    const { error: saveError } = await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          status,
          mp_preapproval_id: resource.id,
          plan_id: resource.preapproval_plan_id,
          current_period_end: periodEnd,
          cancelled_at:
            status === "cancelled" ? now : null,
          raw_payload: resource,
          updated_at: now,
        },
        { onConflict: "user_id" }
      );

    if (saveError) {
      console.error(
        "[webhook] Falha ao salvar assinatura no Supabase."
      );

      // Retornar erro permite que a notificação seja reenviada.
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
    console.error(
      "[webhooks/mercadopago] Erro interno ao processar notificação."
    );

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
