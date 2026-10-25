
import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type WebhookBody = {
  id?: string | number;
  date_created?: string;
  type?: string;
  action?: string;
  data?: {
    id?: string | number;
  };
};

type MercadoPagoSubscription = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  preapproval_plan_id?: string;
  next_payment_date?: string;
};

type AuthorizedPayment = {
  id?: string | number;
  preapproval_id?: string | number;
  status?: string;
  payment?: {
    id?: string | number;
    status?: string;
    status_detail?: string;
  };
};

type EventRecord = {
  id: string;
  event_key: string;
  status: "processing" | "processed" | "failed";
  attempts: number;
  updated_at: string;
};

const SIGNATURE_TOLERANCE_SECONDS = 300;
const STALE_EVENT_MINUTES = 5;

function response(
  error: string,
  status: number
) {
  return NextResponse.json({ error }, { status });
}

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
  try {
    const result = await fetch(
      `https://api.mercadopago.com${path}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!result.ok) {
      console.error(
        "[webhook] Falha ao consultar recurso do Mercado Pago.",
        { httpStatus: result.status }
      );
      return null;
    }

    return (await result.json()) as T;
  } catch {
    console.error("[webhook] Consulta ao Mercado Pago falhou.");
    return null;
  }
}

function makeEventKey(
  body: WebhookBody,
  dataId: string
): string {
  // Identidade estável: não usar request-id, pois ele pode
  // mudar entre reenvios da mesma notificação.
  const identity = JSON.stringify({
    notificationId:
      body.id !== undefined ? String(body.id) : null,
    dateCreated: body.date_created ?? null,
    type: body.type ?? "",
    action: body.action ?? "",
    resourceId: dataId,
  });

  return createHash("sha256").update(identity).digest("hex");
}

export async function POST(request: Request) {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let eventId: string | null = null;

  try {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const expectedPlanId = process.env.MERCADOPAGO_PLAN_ID;

    if (!secret || !accessToken || !expectedPlanId) {
      return response("webhook_not_configured", 503);
    }

    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id");
    const requestId = request.headers.get("x-request-id");
    const signature = request.headers.get("x-signature");

    if (
      !dataId ||
      !/^[A-Za-z0-9_-]+$/.test(dataId) ||
      !verifySignature(signature, requestId, dataId, secret)
    ) {
      return response("invalid_signature", 401);
    }

    const body = (await request.json()) as WebhookBody;

    if (
      body.data?.id !== undefined &&
      String(body.data.id) !== dataId
    ) {
      return response("resource_id_mismatch", 400);
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
        reason: "unsupported_event",
      });
    }

    admin = createAdminClient();

    const eventKey = makeEventKey(body, dataId);
    const now = new Date();
    const nowIso = now.toISOString();
    const staleBefore = new Date(
      now.getTime() - STALE_EVENT_MINUTES * 60 * 1000
    ).toISOString();

    // Registra primeiro o evento. Se a migração ainda não foi
    // aplicada, esta operação falha e o webhook responde 503.
    const { data: inserted, error: insertError } = await admin
      .from("subscription_webhook_events")
      .insert({
        event_key: eventKey,
        notification_type: body.type ?? "unknown",
        notification_action: body.action ?? null,
        resource_id: dataId,
        request_id: requestId,
        status: "processing",
        attempts: 1,
        payload: body,
        updated_at: nowIso,
      })
      .select("id, event_key, status, attempts, updated_at")
      .maybeSingle();

    let event: EventRecord | null =
      inserted as EventRecord | null;

    if (insertError) {
      if (insertError.code !== "23505") {
        console.error(
          "[webhook] Não foi possível registrar o evento."
        );
        return response("event_registration_failed", 503);
      }

      const { data: previous, error: previousError } = await admin
        .from("subscription_webhook_events")
        .select("id, event_key, status, attempts, updated_at")
        .eq("event_key", eventKey)
        .maybeSingle();

      if (previousError || !previous) {
        return response("event_lookup_failed", 503);
      }

      if (previous.status === "processed") {
        return NextResponse.json({
          received: true,
          processed: true,
          duplicate: true,
        });
      }

      // Um evento em processamento recente pode estar sendo
      // executado por outra requisição. Não processá-lo em paralelo.
      if (
        previous.status === "processing" &&
        Date.parse(previous.updated_at) > Date.parse(staleBefore)
      ) {
        return NextResponse.json({
          received: true,
          processed: false,
          inProgress: true,
        });
      }

      // Reivindica novamente eventos que falharam ou ficaram
      // presos em processamento. A condição impede que duas
      // requisições reivindiquem simultaneamente o mesmo estado.
      let claimQuery = admin
        .from("subscription_webhook_events")
        .update({
          status: "processing",
          attempts: previous.attempts + 1,
          last_error_code: null,
          updated_at: nowIso,
        })
        .eq("id", previous.id)
        .eq("status", previous.status);

      if (previous.status === "processing") {
        claimQuery = claimQuery.lt("updated_at", staleBefore);
      }

      const { data: claimed, error: claimError } =
        await claimQuery
          .select("id, event_key, status, attempts, updated_at")
          .maybeSingle();

      if (claimError || !claimed) {
        return NextResponse.json({
          received: true,
          processed: false,
          inProgress: true,
        });
      }

      event = claimed as EventRecord;
    }

    if (!event) {
      return response("event_registration_failed", 503);
    }

    eventId = event.id;

    async function markProcessed() {
      const { error } = await admin!
        .from("subscription_webhook_events")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId!);

      if (error) {
        console.error(
          "[webhook] Falha ao concluir o registro do evento."
        );
        return false;
      }

      return true;
    }

    async function finishIgnored(reason: string) {
      const saved = await markProcessed();

      if (!saved) {
        return response("event_finalization_failed", 503);
      }

      return NextResponse.json({
        received: true,
        processed: false,
        reason,
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
        throw new Error("invoice_lookup_failed");
      }

      preapprovalId =
        invoice.preapproval_id !== undefined
          ? String(invoice.preapproval_id)
          : null;

      paymentApproved = invoice.payment?.status === "approved";
    } else {
      preapprovalId = dataId;
    }

    if (
      !preapprovalId ||
      !/^[A-Za-z0-9_-]+$/.test(preapprovalId)
    ) {
      return await finishIgnored("invalid_preapproval_id");
    }

    // A situação é consultada diretamente no Mercado Pago;
    // o conteúdo recebido no webhook não é fonte de verdade.
    const resource =
      await getMercadoPagoResource<MercadoPagoSubscription>(
        `/preapproval/${encodeURIComponent(preapprovalId)}`,
        accessToken
      );

    if (
      !resource ||
      String(resource.id) !== preapprovalId
    ) {
      throw new Error("subscription_lookup_failed");
    }

    if (resource.preapproval_plan_id !== expectedPlanId) {
      return await finishIgnored("plan_mismatch");
    }

    const userId = getUserId(resource.external_reference);

    if (!userId) {
      return await finishIgnored("invalid_external_reference");
    }

    const { data: existing, error: existingError } = await admin
      .from("subscriptions")
      .select(
        "status, current_period_end, mp_preapproval_id, current_period_start"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      throw new Error("subscription_check_failed");
    }

    if (
      existing?.mp_preapproval_id &&
      existing.mp_preapproval_id !== preapprovalId
    ) {
      return await finishIgnored("subscription_id_mismatch");
    }

    const currentTime = Date.now();
    const resourceStatus = (resource.status ?? "").toLowerCase();

    const oldEndMs = existing?.current_period_end
      ? Date.parse(existing.current_period_end)
      : Number.NaN;

    const oldEndIsFuture =
      Number.isFinite(oldEndMs) && oldEndMs > currentTime;

    const nextPaymentMs = resource.next_payment_date
      ? Date.parse(resource.next_payment_date)
      : Number.NaN;

    const nextPaymentIsFuture =
      Number.isFinite(nextPaymentMs) &&
      nextPaymentMs > currentTime;

    let status:
      | "active"
      | "pending"
      | "cancelled"
      | "past_due"
      | "rejected"
      | "expired" = "pending";

    let periodEnd: string | null = null;
    let cancelledAt: string | null = null;

    if (
      resourceStatus === "cancelled" ||
      resourceStatus === "canceled"
    ) {
      // Cancelar a renovação não deve apagar o período que já
      // estava confirmado. Sem data válida, não haverá acesso.
      status = "cancelled";
      periodEnd = oldEndIsFuture
        ? new Date(oldEndMs).toISOString()
        : existing?.current_period_end ?? null;
      cancelledAt = nowIso;
    } else if (
      // Não reativar uma assinatura cancelada apenas por causa
      // de uma notificação atrasada ou fora de ordem.
      existing?.status === "cancelled"
    ) {
      status = "cancelled";
      periodEnd = existing.current_period_end ?? null;
      cancelledAt = nowIso;
    } else {
      switch (resourceStatus) {
        case "authorized":
          if (paymentApproved && nextPaymentIsFuture) {
            status = "active";
            periodEnd = new Date(nextPaymentMs).toISOString();
          } else if (
            existing?.status === "active" &&
            oldEndIsFuture
          ) {
            // Notificações de assinatura sem confirmação de uma
            // nova cobrança não apagam o período já validado.
            status = "active";
            periodEnd = new Date(oldEndMs).toISOString();
          } else {
            status = "pending";
          }
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

        default:
          status = "pending";
      }
    }

    const { error: saveError } = await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          status,
          mp_preapproval_id: preapprovalId,
          plan_id: resource.preapproval_plan_id,
          current_period_start:
            existing?.current_period_start ?? null,
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
      throw new Error("subscription_persistence_failed");
    }

    if (!(await markProcessed())) {
      // O registro da assinatura pode ter sido salvo, mas o evento
      // continua recuperável se a finalização falhar.
      return response("event_finalization_failed", 503);
    }

    return NextResponse.json({
      received: true,
      processed: true,
    });
  } catch (error) {
    const errorCode =
      error instanceof Error
        ? error.message
        : "internal_error";

    console.error("[webhook] Processamento não concluído.", {
      errorCode,
    });

    if (admin && eventId) {
      const { error: eventError } = await admin
        .from("subscription_webhook_events")
        .update({
          status: "failed",
          last_error_code: errorCode.slice(0, 120),
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId)
        .eq("status", "processing");

      if (eventError) {
        console.error(
          "[webhook] Falha ao registrar o erro do evento."
        );
      }
    }

    return response("webhook_processing_failed", 503);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Mercado Pago — use POST para notificações.",
  });
}
