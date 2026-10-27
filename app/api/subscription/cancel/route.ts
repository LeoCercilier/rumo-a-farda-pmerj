
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MercadoPagoSubscription = {
  id?: string | number;
  status?: string;
  external_reference?: string;
  preapproval_plan_id?: string;
};

function errorResponse(
  error: string,
  message: string,
  status: number
) {
  return NextResponse.json({ error, message }, { status });
}

function isCancelled(status: string) {
  return status === "cancelled" || status === "canceled";
}

export async function POST(request: Request) {
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const expectedPlanId = process.env.MERCADOPAGO_PLAN_ID;

    if (!appUrl || !accessToken || !expectedPlanId) {
      return errorResponse(
        "billing_not_configured",
        "O cancelamento está temporariamente indisponível.",
        503
      );
    }

    // Bloqueia origens externas quando o navegador envia o cabeçalho Origin.
    const origin = request.headers.get("origin");

    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(appUrl).origin) {
          return errorResponse(
            "invalid_origin",
            "Solicitação não autorizada.",
            403
          );
        }
      } catch {
        return errorResponse(
          "invalid_origin",
          "Solicitação não autorizada.",
          403
        );
      }
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse(
        "unauthenticated",
        "Entre na sua conta para cancelar a assinatura.",
        401
      );
    }

    const admin = createAdminClient();

    const { data: subscription, error: dbError } = await admin
      .from("subscriptions")
      .select("status, mp_preapproval_id, plan_id, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    if (dbError) {
      return errorResponse(
        "subscription_lookup_failed",
        "Não foi possível consultar sua assinatura.",
        503
      );
    }

    if (
      !subscription?.mp_preapproval_id ||
      subscription.plan_id !== expectedPlanId
    ) {
      return errorResponse(
        "subscription_not_found",
        "Não foi encontrada uma assinatura válida para cancelar.",
        404
      );
    }

    const preapprovalId = subscription.mp_preapproval_id;

    if (!/^[A-Za-z0-9_-]+$/.test(preapprovalId)) {
      return errorResponse(
        "invalid_subscription_id",
        "O identificador da assinatura é inválido.",
        409
      );
    }

    // Consulta a assinatura remota antes de solicitar qualquer alteração.
    const lookupResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!lookupResponse.ok) {
      return errorResponse(
        "mercadopago_lookup_failed",
        "Não foi possível confirmar sua assinatura no Mercado Pago.",
        502
      );
    }

    const remote =
      (await lookupResponse.json()) as MercadoPagoSubscription;

    const referencePattern =
      /^user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const referenceMatch =
      remote.external_reference?.match(referencePattern);

    if (
      String(remote.id) !== preapprovalId ||
      remote.preapproval_plan_id !== expectedPlanId ||
      referenceMatch?.[1]?.toLowerCase() !== user.id.toLowerCase()
    ) {
      return errorResponse(
        "subscription_ownership_mismatch",
        "Não foi possível confirmar que esta assinatura pertence à sua conta.",
        403
      );
    }

    const remoteStatus = (remote.status ?? "").toLowerCase();

    if (isCancelled(remoteStatus)) {
      return NextResponse.json({
        success: true,
        alreadyCancelled: true,
        message:
          "O Mercado Pago informa que a assinatura já está cancelada. Atualize o status do aplicativo para verificar a sincronização.",
      });
    }

    if (remoteStatus !== "authorized" && remoteStatus !== "pending") {
      return errorResponse(
        "subscription_not_cancellable",
        "A assinatura não está em um estado que permita este cancelamento.",
        409
      );
    }

    const cancelResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "cancelled" }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!cancelResponse.ok) {
      console.error(
        "[subscription/cancel] Mercado Pago recusou o cancelamento.",
        { httpStatus: cancelResponse.status }
      );

      return errorResponse(
        "mercadopago_cancel_failed",
        "O Mercado Pago não confirmou o cancelamento. Verifique o status antes de tentar novamente.",
        502
      );
    }

    const result =
      (await cancelResponse.json()) as MercadoPagoSubscription;

    const resultStatus = (result.status ?? "").toLowerCase();

    if (
      String(result.id) !== preapprovalId ||
      !isCancelled(resultStatus)
    ) {
      return errorResponse(
        "cancel_confirmation_uncertain",
        "A solicitação foi enviada, mas o cancelamento ainda não pôde ser confirmado. Atualize o status antes de tentar novamente.",
        502
      );
    }

    // O webhook continua sendo responsável por sincronizar o banco.
    return NextResponse.json({
      success: true,
      message:
        "Cancelamento confirmado pelo Mercado Pago. A atualização do status e da validade do acesso depende do processamento da notificação.",
    });
  } catch {
    console.error("[subscription/cancel] Falha inesperada.");

    return errorResponse(
      "server_error",
      "Não foi possível confirmar o cancelamento. Atualize o status antes de tentar novamente.",
      500
    );
  }
}
