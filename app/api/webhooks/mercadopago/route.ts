import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook do Mercado Pago.
 *
 * - Valida autenticidade quando MERCADOPAGO_WEBHOOK_SECRET estiver configurado.
 * - Não confia em URLs de retorno do browser.
 * - Atualiza subscriptions apenas com service role.
 * - Idempotente na medida do possível.
 *
 * A tabela `subscriptions` e o mapeamento completo de eventos dependem
 * do responsável pelo Supabase e da configuração final do MP.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;

    // Validação básica de secret via query ou header (ajuste conforme doc MP em uso).
    if (secret) {
      const url = new URL(request.url);
      const qsSecret = url.searchParams.get("secret");
      const headerSecret = request.headers.get("x-webhook-secret");
      if (qsSecret !== secret && headerSecret !== secret) {
        return NextResponse.json({ error: "invalid_secret" }, { status: 401 });
      }
    }

    const body = (await request.json()) as {
      type?: string;
      action?: string;
      data?: { id?: string };
      id?: string;
    };

    const resourceId = body.data?.id || body.id;
    if (!resourceId || !accessToken) {
      // Responde 200 para evitar retentativas agressivas em payloads incompletos de teste.
      return NextResponse.json({ received: true, processed: false });
    }

    // Busca o recurso no MP para não confiar só no payload do webhook.
    const resourceType =
      body.type === "subscription_preapproval" ||
      body.action?.includes("preapproval")
        ? "preapproval"
        : body.type === "payment"
          ? "payment"
          : "preapproval";

    const mpRes = await fetch(
      `https://api.mercadopago.com/${resourceType}/${resourceId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!mpRes.ok) {
      console.error("[webhook] Falha ao consultar recurso MP", resourceId);
      return NextResponse.json({ received: true, processed: false });
    }

    const resource = (await mpRes.json()) as {
      id?: string;
      status?: string;
      external_reference?: string;
      payer_email?: string;
      preapproval_id?: string;
    };

    const externalRef = resource.external_reference || "";
    const userMatch = externalRef.match(/user:([0-9a-f-]{36})/i);
    const userId = userMatch?.[1];

    if (!userId) {
      console.warn("[webhook] external_reference sem user id:", externalRef);
      return NextResponse.json({ received: true, processed: false });
    }

    const mpStatus = (resource.status || "").toLowerCase();
    let status: string = "pending";

    if (
      mpStatus === "authorized" ||
      mpStatus === "active" ||
      mpStatus === "approved"
    ) {
      status = "active";
    } else if (mpStatus === "cancelled" || mpStatus === "canceled") {
      status = "cancelled";
    } else if (mpStatus === "paused") {
      status = "past_due";
    } else if (mpStatus === "rejected") {
      status = "rejected";
    }

    try {
      const admin = createAdminClient();
      const periodEnd =
        status === "active"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null;

      await admin.from("subscriptions").upsert(
        {
          user_id: userId,
          status,
          mp_preapproval_id: resource.id ?? null,
          current_period_start:
            status === "active" ? new Date().toISOString() : null,
          current_period_end: periodEnd,
          raw_payload: resource,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch (e) {
      console.error(
        "[webhook] Falha ao persistir assinatura (tabela pode não existir):",
        e
      );
      // Ainda retorna 200 para o MP não retentar infinitamente durante setup.
    }

    return NextResponse.json({ received: true, processed: true });
  } catch (error) {
    console.error("[webhooks/mercadopago]", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Mercado Pago — use POST para notificações.",
  });
}
