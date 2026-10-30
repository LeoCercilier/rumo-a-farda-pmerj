
import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionStatus =
  | "none"
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "rejected";

export type SubscriptionInfo = {
  authenticated: boolean;
  hasAccess: boolean;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  planId: string | null;
  message?: string;
};

const VALID_STATUSES: readonly SubscriptionStatus[] = [
  "none",
  "pending",
  "active",
  "past_due",
  "cancelled",
  "expired",
  "rejected",
];

function normalizeStatus(value: unknown): SubscriptionStatus {
  if (
    typeof value === "string" &&
    VALID_STATUSES.includes(value as SubscriptionStatus)
  ) {
    return value as SubscriptionStatus;
  }

  return "none";
}

function noAccess(
  authenticated: boolean,
  status: SubscriptionStatus,
  message: string,
  currentPeriodEnd: string | null = null,
  planId: string | null = null
): SubscriptionInfo {
  return {
    authenticated,
    hasAccess: false,
    status,
    currentPeriodEnd,
    planId,
    message,
  };
}

/**
 * Verifica primeiro uma concessão manual de Premium.
 *
 * A concessão manual é independente do Mercado Pago:
 * - status active;
 * - início já alcançado;
 * - sem data final ou com data final futura.
 *
 * Se não houver concessão manual válida, mantém a
 * verificação original da assinatura do Mercado Pago.
 */
export async function getSubscriptionForUser(
  supabase: SupabaseClient,
  userId: string | null
): Promise<SubscriptionInfo> {
  if (!userId) {
    return noAccess(
      false,
      "none",
      "Faça login para verificar sua assinatura."
    );
  }

  try {
    const { data: manualGrant } = await supabase
      .from("manual_premium_grants")
      .select("status, starts_at, ends_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (manualGrant?.status === "active") {
      const startsAt =
        typeof manualGrant.starts_at === "string"
          ? Date.parse(manualGrant.starts_at)
          : Number.NaN;

      const endsAt =
        typeof manualGrant.ends_at === "string"
          ? Date.parse(manualGrant.ends_at)
          : null;

      const now = Date.now();

      const validStart =
        Number.isFinite(startsAt) && startsAt <= now;

      const validEnd =
        endsAt === null ||
        (Number.isFinite(endsAt) && endsAt > now);

      if (validStart && validEnd) {
        return {
          authenticated: true,
          hasAccess: true,
          status: "active",
          currentPeriodEnd: manualGrant.ends_at ?? null,
          planId: null,
          message: "Acesso Premium concedido manualmente.",
        };
      }
    }

    // Mantém a verificação original do Mercado Pago.
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, current_period_end, plan_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return noAccess(
        true,
        "none",
        "Não foi possível confirmar sua assinatura. Tente novamente."
      );
    }

    if (!data) {
      return noAccess(
        true,
        "none",
        "Nenhuma assinatura encontrada. Assine para liberar o conteúdo."
      );
    }

    const status = normalizeStatus(data.status);

    const currentPeriodEnd =
      typeof data.current_period_end === "string"
        ? data.current_period_end
        : null;

    const planId =
      typeof data.plan_id === "string" ? data.plan_id : null;

    if (status !== "active" && status !== "cancelled") {
      return noAccess(
        true,
        status,
        status === "pending"
          ? "Sua assinatura está aguardando confirmação do pagamento."
          : status === "past_due"
            ? "Não foi possível confirmar a renovação da assinatura."
            : "Sua assinatura não está ativa.",
        currentPeriodEnd,
        planId
      );
    }

    if (!currentPeriodEnd) {
      return noAccess(
        true,
        status,
        "Não há uma data final confirmada para o período pago.",
        null,
        planId
      );
    }

    const endTimestamp = Date.parse(currentPeriodEnd);

    if (!Number.isFinite(endTimestamp)) {
      return noAccess(
        true,
        status,
        "Não foi possível validar a validade da assinatura.",
        currentPeriodEnd,
        planId
      );
    }

    if (endTimestamp <= Date.now()) {
      return noAccess(
        true,
        status === "active" ? "expired" : "cancelled",
        status === "cancelled"
          ? "Sua assinatura foi cancelada e o período pago terminou."
          : "Sua assinatura expirou. Renove para recuperar o acesso.",
        currentPeriodEnd,
        planId
      );
    }

    return {
      authenticated: true,
      hasAccess: true,
      status,
      currentPeriodEnd,
      planId,
      message:
        status === "cancelled"
          ? "A renovação foi cancelada. Seu acesso continua até o fim do período pago."
          : undefined,
    };
  } catch {
    return noAccess(
      true,
      "none",
      "Não foi possível verificar sua assinatura no momento."
    );
  }
}
