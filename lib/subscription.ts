
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

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

type AccessInterval = {
  start: number;
  end: number;
};

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

function validTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function findCurrentAccessEnd(
  intervals: AccessInterval[],
  now: number
): number | null {
  const sorted = intervals
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);

  let merged: AccessInterval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  const current = merged.find(
    (interval) => interval.start <= now && interval.end > now
  );

  return current?.end ?? null;
}

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
      const startsAt = validTimestamp(manualGrant.starts_at);
      const endsAt =
        manualGrant.ends_at === null
          ? null
          : validTimestamp(manualGrant.ends_at);

      const now = Date.now();

      if (
        startsAt !== null &&
        startsAt <= now &&
        (manualGrant.ends_at === null ||
          (endsAt !== null && endsAt > now))
      ) {
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

    // Pix é consultado exclusivamente no servidor, usando
    // o cliente administrativo. Nenhuma chave privada vai ao cliente.
    const admin = createAdminClient();

    const [subscriptionResult, pixResult] = await Promise.all([
      supabase
        .from("subscriptions")
        .select(
          "status, current_period_start, current_period_end, plan_id"
        )
        .eq("user_id", userId)
        .maybeSingle(),

      admin
        .from("pix_payments")
        .select("amount, currency, status, access_starts_at, access_until")
        .eq("user_id", userId)
        .eq("status", "approved")
        .eq("currency", "BRL")
        .eq("amount", 19.9)
        .not("access_starts_at", "is", null)
        .not("access_until", "is", null),
    ]);

    const now = Date.now();
    const intervals: AccessInterval[] = [];

    const subscription = subscriptionResult.data;

    if (
      subscription &&
      (subscription.status === "active" ||
        subscription.status === "cancelled")
    ) {
      const end = validTimestamp(subscription.current_period_end);
      const start = validTimestamp(subscription.current_period_start);

      if (end !== null && end > now) {
        intervals.push({
          start: start ?? Number.NEGATIVE_INFINITY,
          end,
        });
      }
    }

    if (!pixResult.error && Array.isArray(pixResult.data)) {
      for (const payment of pixResult.data) {
        const start = validTimestamp(payment.access_starts_at);
        const end = validTimestamp(payment.access_until);

        if (
          Number(payment.amount) === 19.9 &&
          payment.currency === "BRL" &&
          payment.status === "approved" &&
          start !== null &&
          end !== null &&
          end > start
        ) {
          intervals.push({ start, end });
        }
      }
    }

    const accessEnd = findCurrentAccessEnd(intervals, now);

    if (accessEnd !== null) {
      return {
        authenticated: true,
        hasAccess: true,
        status:
          subscription?.status === "cancelled" &&
          validTimestamp(subscription.current_period_end) !== null &&
          validTimestamp(subscription.current_period_end)! > now
            ? "cancelled"
            : "active",
        currentPeriodEnd: new Date(accessEnd).toISOString(),
        planId:
          typeof subscription?.plan_id === "string"
            ? subscription.plan_id
            : "pix",
        message: "Acesso Premium ativo.",
      };
    }

    if (subscriptionResult.error) {
      return noAccess(
        true,
        "none",
        "Não foi possível confirmar sua assinatura. Tente novamente."
      );
    }

    if (pixResult.error) {
      return noAccess(
        true,
        "none",
        "Não foi possível confirmar seus pagamentos Pix. Tente novamente."
      );
    }

    if (!subscription) {
      return noAccess(
        true,
        "none",
        "Nenhuma assinatura encontrada. Assine para liberar o conteúdo."
      );
    }

    const status = normalizeStatus(subscription.status);

    const currentPeriodEnd =
      typeof subscription.current_period_end === "string"
        ? subscription.current_period_end
        : null;

    const planId =
      typeof subscription.plan_id === "string"
        ? subscription.plan_id
        : null;

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

    if (endTimestamp <= now) {
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
  } catch (error) {
    console.error("[subscription] Falha ao verificar acesso.");

    return noAccess(
      true,
      "none",
      "Não foi possível verificar sua assinatura no momento."
    );
  }
}
