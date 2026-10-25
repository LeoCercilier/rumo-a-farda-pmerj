
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { SubscriptionInfo } from "@/lib/subscription";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  subscription: SubscriptionInfo | null;
  subscriptionLoading: boolean;
  refreshSubscription: () => Promise<void>;
  signOut: () => Promise<void>;
};

const defaultSubscription: SubscriptionInfo = {
  authenticated: false,
  hasAccess: false,
  status: "none",
  currentPeriodEnd: null,
  planId: null,
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isSubscriptionInfo(value: unknown): value is SubscriptionInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Partial<SubscriptionInfo>;

  return (
    typeof data.authenticated === "boolean" &&
    typeof data.hasAccess === "boolean" &&
    typeof data.status === "string" &&
    typeof data.currentPeriodEnd === "string" ||
    (
      !!value &&
      typeof value === "object" &&
      typeof (value as Partial<SubscriptionInfo>).authenticated === "boolean" &&
      typeof (value as Partial<SubscriptionInfo>).hasAccess === "boolean" &&
      typeof (value as Partial<SubscriptionInfo>).status === "string" &&
      (value as Partial<SubscriptionInfo>).currentPeriodEnd === null
    )
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null
  );
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const refreshSubscription = useCallback(async () => {
    setSubscriptionLoading(true);

    try {
      const res = await fetch("/api/subscription/status", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Não foi possível consultar a assinatura.");
      }

      const data: unknown = await res.json();

      if (!isSubscriptionInfo(data)) {
        throw new Error("Resposta de assinatura inválida.");
      }

      setSubscription(data);
    } catch {
      setSubscription({
        ...defaultSubscription,
        message: "Não foi possível confirmar sua assinatura. Tente novamente.",
      });
    } finally {
      setSubscriptionLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (!mounted) return;

        if (error) {
          setUser(null);
        } else {
          setUser(data.user ?? null);
        }
      } catch {
        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadUser();

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);

      // Não manter na interface o estado Premium da conta anterior.
      setSubscription({
        ...defaultSubscription,
      });

      setLoading(false);
    });

    return () => {
      mounted = false;
      authSub.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (loading) return;

    // A consulta no servidor é a fonte do estado da assinatura.
    void refreshSubscription();
  }, [loading, user?.id, refreshSubscription]);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }
    } finally {
      setSubscription({
        ...defaultSubscription,
      });
    }
  }, [supabase]);

  const value = useMemo(
    () => ({
      user,
      loading,
      subscription,
      subscriptionLoading,
      refreshSubscription,
      signOut,
    }),
    [
      user,
      loading,
      subscription,
      subscriptionLoading,
      refreshSubscription,
      signOut,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }

  return ctx;
}
