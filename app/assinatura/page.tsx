 
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
        "Retorno do checkout recebido. A liberação do acesso depende da confirmação do pagamento pelo Mercado Pago. Atualize o status abaixo."
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
          data.message || "Não foi possível iniciar a assinatura."
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
          <h1>Rumo à Farda Premium</h1>
          <p className="page-intro">
            Entre ou crie sua conta para acompanhar sua assinatura e acessar os
            recursos Premium quando a contratação estiver disponível.
          </p>
          <p className="auth-links">
            <Link href="/login" className="primary-button">
              ENTRAR →
            </Link>{" "}
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
        <h1>Rumo à Farda Premium</h1>
        <p className="page-intro">
          Logado como <strong>{user.email}</strong>
        </p>

        {notice && <p className="auth-success">{notice}</p>}

        <article className="feature-card" style={{ marginTop: "1rem" }}>
          <h2>Plano mensal</h2>
          <p>
            <strong>R$ 19,90 por mês</strong>
          </p>
          <p>
            Cobrança recorrente mensal, com duração indeterminada, conforme as
            condições apresentadas pelo Mercado Pago antes da confirmação da
            contratação.
          </p>
          <p>
            A assinatura ainda está em fase de configuração e validação. A
            contratação ficará disponível após a conclusão dos testes e a
            autorização para habilitar as cobranças.
          </p>
        </article>

        <article className="feature-card" style={{ marginTop: "1rem" }}>
          <h2>Status da assinatura</h2>
          <p>
            <strong>Estado:</strong> {status}
          </p>
          <p>
            <strong>Acesso Premium:</strong>{" "}
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
            <h2>Contratação</h2>
            <p>
              O acesso Premium só será liberado após a confirmação da assinatura
              pelo servidor. O retorno do checkout, por si só, não comprova
              pagamento.
            </p>

            {checkoutError && (
              <p className="auth-error" role="alert">
                {checkoutError}
              </p>
            )}

            <button
              className="primary-button"
              type="button"
              disabled={checkoutLoading}
              onClick={() => void startCheckout()}
            >
              {checkoutLoading
                ? "VERIFICANDO DISPONIBILIDADE..."
                : "VERIFICAR DISPONIBILIDADE"}
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
