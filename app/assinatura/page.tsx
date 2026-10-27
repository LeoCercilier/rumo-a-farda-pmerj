
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
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
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

  async function cancelSubscription() {
    const confirmed = window.confirm(
      "Deseja realmente cancelar sua assinatura Premium? O Mercado Pago será consultado para confirmar o cancelamento. A atualização do acesso no aplicativo depende da confirmação recebida pelo servidor."
    );

    if (!confirmed) return;

    setCancelError(null);
    setNotice(null);
    setCancelLoading(true);

    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setCancelError(
          data.message || "Não foi possível confirmar o cancelamento."
        );
        return;
      }

      setNotice(
        data.message ||
          "Solicitação processada. Atualize o status para conferir a situação da assinatura."
      );

      await refreshSubscription();
    } catch {
      setCancelError(
        "Falha de comunicação. Confira o status da assinatura antes de tentar novamente."
      );
    } finally {
      setCancelLoading(false);
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
  const canCancel = status === "active" || status === "pending";

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">SUA CONTA</span>
        <h1>Rumo à Farda Premium</h1>
        <p className="page-intro">
          Logado como <strong>{user.email}</strong>
        </p>

        {notice && (
          <p className="auth-success" role="status">
            {notice}
          </p>
        )}

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
            A contratação ainda depende da conclusão dos testes e da autorização
            para habilitar as cobranças.
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
            disabled={cancelLoading || checkoutLoading}
            onClick={() => void refreshSubscription()}
          >
            ATUALIZAR STATUS
          </button>

          {canCancel && (
            <div style={{ marginTop: "1rem" }}>
              <p>
                Você pode solicitar o cancelamento da assinatura por aqui.
                Aguarde a confirmação do Mercado Pago para verificar a
                atualização do status e do acesso.
              </p>

              {cancelError && (
                <p className="auth-error" role="alert">
                  {cancelError}
                </p>
              )}

              <button
                className="secondary-button"
                type="button"
                disabled={cancelLoading || checkoutLoading}
                onClick={() => void cancelSubscription()}
              >
                {cancelLoading
                  ? "PROCESSANDO CANCELAMENTO..."
                  : "CANCELAR ASSINATURA"}
              </button>
            </div>
          )}
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
              disabled={checkoutLoading || cancelLoading}
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
