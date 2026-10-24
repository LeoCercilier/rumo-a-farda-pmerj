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

const ACCESS_STATUSES: SubscriptionStatus[] = ["active"];

/**
 * Consulta o estado da assinatura do usuário autenticado.
 *
 * Depende da tabela `public.subscriptions` (ainda a ser criada no Supabase).
 * Se a tabela não existir ou a query falhar, retorna sem acesso de forma segura.
 */
export async function getSubscriptionForUser(
  supabase: SupabaseClient,
  userId: string | null
): Promise<SubscriptionInfo> {
  if (!userId) {
    return {
      authenticated: false,
      hasAccess: false,
      status: "none",
      currentPeriodEnd: null,
      planId: null,
      message: "Faça login para verificar sua assinatura.",
    };
  }

  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, current_period_end, plan_id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      // Tabela inexistente ou RLS: não conceder acesso.
      return {
        authenticated: true,
        hasAccess: false,
        status: "none",
        currentPeriodEnd: null,
        planId: null,
        message:
          "Assinatura ainda não disponível. A configuração do backend está pendente.",
      };
    }

    if (!data) {
      return {
        authenticated: true,
        hasAccess: false,
        status: "none",
        currentPeriodEnd: null,
        planId: null,
        message: "Nenhuma assinatura encontrada. Assine para liberar o conteúdo.",
      };
    }

    const status = (data.status as SubscriptionStatus) || "none";
    const periodEnd =
      typeof data.current_period_end === "string"
        ? data.current_period_end
        : null;

    let hasAccess = ACCESS_STATUSES.includes(status);

    if (hasAccess && periodEnd) {
      const end = new Date(periodEnd).getTime();
      if (!Number.isNaN(end) && end < Date.now()) {
        hasAccess = false;
      }
    }

    return {
      authenticated: true,
      hasAccess,
      status: hasAccess ? status : status === "active" ? "expired" : status,
      currentPeriodEnd: periodEnd,
      planId: typeof data.plan_id === "string" ? data.plan_id : null,
    };
  } catch {
    return {
      authenticated: true,
      hasAccess: false,
      status: "none",
      currentPeriodEnd: null,
      planId: null,
      message: "Não foi possível verificar a assinatura no momento.",
    };
  }
}
