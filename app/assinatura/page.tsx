"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

function AssinaturaContent() {
  const { user, loading, subscription, refreshSubscription, signOut } =
    useAuth();
  const searchParams = useSearchParams();
  const retorno = searchParams.get("retorno");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (retorno === "ok") {
      setNotice(
        "Retorno do checkout recebido. A liberação do acesso depende da confirmação do pagamento pelo Mercado Pago — isso pode levar alguns instantes. Atualize o status abaixo."
      );
      void refreshSubscription();
    }
  }, [retorno, refreshSubscription]);

  async function startCheckout() {
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (!res.ok) {
        setCheckoutError(
          data.message || "Não foi possível iniciar o checkout."
        );
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setCheckoutError("URL de checkout não disponível.");
    } catch {
      setCheckoutError("Falha de comunicação com o servidor.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p>Carregando...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="eyebrow">ASSINATURA</span>
          <h1>Acesso premium</h1>
          <p className="page-intro">
            Faça login ou crie uma conta para gerenciar sua assinatura e liberar
            gabaritos, explicações e simulados completos.
          </p>
          <p className="auth-links">
            <Link href="/login" className="primary-button">
              ENTRAR →
            </Link>
            {" "}
            <Link href="/cadastro" className="secondary-button">
              CRIAR CONTA
            </Link>
          </p>
          <p className="auth-links">
            <Link href="/">Voltar ao início</Link>
          </p>
        </section>
      </main>
    );
  }

  const hasAccess = subscription?.hasAccess === true;
  const status = subscription?.status ?? "none";

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">SUA CONTA</span>
        <h1>Assinatura</h1>
        <p className="page-intro">
          Logado como <strong>{user.email}</strong>
        </p>

        {notice && <p className="auth-success">{notice}</p>}

        <article className="feature-card" style={{ marginTop: "1rem" }}>
          <h2>Status atual</h2>
          <p>
            <strong>Estado:</strong> {status}
          </p>
          <p>
            <strong>Acesso premium:</strong>{" "}
            {hasAccess ? "Liberado" : "Bloqueado"}
          </p>
          {subscription?.currentPeriodEnd && (
            <p>
              <strong>Válido até:</strong>{" "}
              {new Date(subscription.currentPeriodEnd).toLocaleString("pt-BR")}
            </p>
          )}
          {subscription?.message && <p>{subscription.message}</p>}
          <button
            className="secondary-button"
            type="button"
            onClick={() => void refreshSubscription()}
          >
            ATUALIZAR STATUS
          </button>
        </article>

        {!hasAccess && (
          <article className="feature-card" style={{ marginTop: "1rem" }}>
            <h2>Assinar</h2>
            <p>
              O valor, a frequência e o plano comercial serão confirmados antes
              da cobrança real. O checkout é processado pelo Mercado Pago; o
              acesso só é liberado após confirmação do pagamento (webhook), não
              apenas pelo retorno nesta página.
            </p>
            {checkoutError && <p className="auth-error">{checkoutError}</p>}
            <button
              className="primary-button"
              type="button"
              disabled={checkoutLoading}
              onClick={() => void startCheckout()}
            >
              {checkoutLoading ? "Abrindo checkout..." : "IR PARA O CHECKOUT →"}
            </button>
          </article>
        )}

        <p className="auth-links" style={{ marginTop: "1.5rem" }}>
          <Link href="/">Voltar ao app</Link>
          {" · "}
          <button
            type="button"
            className="link-button"
            onClick={() => void signOut()}
          >
            Sair
          </button>
        </p>
      </section>
    </main>
  );
}

export default function AssinaturaPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <section className="auth-card">
            <p>Carregando...</p>
          </section>
        </main>
      }
    >
      <AssinaturaContent />
    </Suspense>
  );
}
