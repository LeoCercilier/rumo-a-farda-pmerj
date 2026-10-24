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
        credentials: "include",
      });
      const data = (await res.json()) as SubscriptionInfo;
      setSubscription(data);
    } catch {
      setSubscription({
        ...defaultSubscription,
        message: "Não foi possível verificar a assinatura.",
      });
    } finally {
      setSubscriptionLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      authSub.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (loading) return;
    void refreshSubscription();
  }, [loading, user?.id, refreshSubscription]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSubscription({ ...defaultSubscription });
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
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }
  return ctx;
}
