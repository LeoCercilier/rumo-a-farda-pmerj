
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/AuthProvider";

type CardFormData = {
  token?: string;
};

type MercadoPagoCardForm = {
  getCardFormData: () => CardFormData;
};

type CardField = { id: string };

type MercadoPagoCardFormConfig = {
  amount: string;
  iframe: boolean;
  form: {
    id: string;
    cardholderName: CardField;
    cardholderEmail: CardField;
    cardNumber: CardField;
    expirationDate: CardField;
    securityCode: CardField;
    issuer: CardField;
    installments: CardField;
    identificationType: CardField;
    identificationNumber: CardField;
  };
  callbacks: {
    onFormMounted: (error?: unknown) => void;
    onSubmit: (event: Event) => void;
    onFetching: (resource: string) => () => void;
  };
};

type MercadoPagoInstance = {
  cardForm: (
    config: MercadoPagoCardFormConfig
  ) => MercadoPagoCardForm;
};

declare global {
  interface Window {
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string }
    ) => MercadoPagoInstance;
  }
}

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
  const [cardFormReady, setCardFormReady] = useState(false);

  const cardFormRef = useRef<MercadoPagoCardForm | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;

  const submitCard = useCallback(
    async (event: Event) => {
      event.preventDefault();
      setCheckoutError(null);
      setNotice(null);

      const cardForm = cardFormRef.current;

      if (!cardForm) {
        setCheckoutError(
          "O formulário ainda está carregando. Aguarde e tente novamente."
        );
        return;
      }

      setCheckoutLoading(true);

      try {
        const cardData = cardForm.getCardFormData();

        if (!cardData.token) {
          setCheckoutError(
            "Não foi possível validar o cartão. Confira os dados e tente novamente."
          );
          return;
        }

        const res = await fetch("/api/subscription/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            card_token_id: cardData.token,
          }),
        });

        const data = (await res.json()) as {
          checkoutUrl?: string;
          subscriptionCreated?: boolean;
          message?: string;
        };

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

        if (data.subscriptionCreated) {
          setNotice(
            data.message ||
              "Solicitação registrada. Aguardando confirmação do Mercado Pago."
          );
          await refreshSubscription();
          return;
        }

        setCheckoutError(
          "O servidor não confirmou a criação da assinatura. Atualize o status antes de tentar novamente."
        );
      } catch {
        setCheckoutError(
          "Não foi possível concluir a solicitação. Atualize o status antes de tentar novamente."
        );
      } finally {
        setCheckoutLoading(false);
      }
    },
    [refreshSubscription]
  );

  useEffect(() => {
    if (retorno === "ok") {
      setNotice(
        "Retorno do Mercado Pago recebido. O acesso Premium depende da confirmação do pagamento pelo servidor."
      );
      void refreshSubscription();
    }
  }, [retorno, refreshSubscription]);

  useEffect(() => {
    if (!user || !publicKey || cardFormRef.current) return;

    let cancelled = false;

    const initializeCardForm = () => {
      if (cancelled || !window.MercadoPago || cardFormRef.current) {
        return;
      }

      try {
        const mp = new window.MercadoPago(publicKey, {
          locale: "pt-BR",
        });

        cardFormRef.current = mp.cardForm({
          amount: "19.90",
          iframe: true,
          form: {
            id: "form-checkout",
            cardholderName: {
              id: "form-checkout__cardholderName",
            },
            cardholderEmail: {
              id: "form-checkout__cardholderEmail",
            },
            cardNumber: {
              id: "form-checkout__cardNumber",
            },
            expirationDate: {
              id: "form-checkout__expirationDate",
            },
            securityCode: {
              id: "form-checkout__securityCode",
            },
            issuer: {
              id: "form-checkout__issuer",
            },
            installments: {
              id: "form-checkout__installments",
            },
            identificationType: {
              id: "form-checkout__identificationType",
            },
            identificationNumber: {
              id: "form-checkout__identificationNumber",
            },
          },
          callbacks: {
            onFormMounted: (error?: unknown) => {
              if (error) {
                console.error(
                  "[assinatura] Falha ao montar formulário."
                );
                setCheckoutError(
                  "Não foi possível carregar os campos do cartão. Recarregue a página."
                );
                return;
              }

              setCardFormReady(true);
            },
            onSubmit: (event: Event) => {
              void submitCard(event);
            },
            onFetching: (_resource: string) => {
              return () => undefined;
            },
          },
        });
      } catch {
        setCheckoutError(
          "Não foi possível inicializar o formulário de pagamento. Recarregue a página."
        );
      }
    };

    if (window.MercadoPago) {
      initializeCardForm();
    } else {
      const scriptUrl = "https://sdk.mercadopago.com/js/v2";
      let script = document.querySelector<HTMLScriptElement>(
        'script[src="https://sdk.mercadopago.com/js/v2"]'
      );

      if (!script) {
        script = document.createElement("script");
        script.src = scriptUrl;
        script.async = true;
        document.head.appendChild(script);
      }

      const handleLoad = () => initializeCardForm();

      const handleError = () => {
        if (!cancelled) {
          setCheckoutError(
            "Não foi possível carregar o serviço de pagamentos. Verifique sua conexão e recarregue a página."
          );
        }
      };

      script.addEventListener("load", handleLoad);
      script.addEventListener("error", handleError);

      return () => {
        cancelled = true;
        script?.removeEventListener("load", handleLoad);
        script?.removeEventListener("error", handleError);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [user, publicKey, submitCard]);

  async function cancelSubscription() {
    const confirmed = window.confirm(
      "Deseja realmente cancelar sua assinatura Premium? O Mercado Pago será consultado para confirmar o cancelamento."
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
          "Solicitação processada. Atualize o status para conferir a assinatura."
      );

      await refreshSubscription();
    } catch {
      setCancelError(
        "Falha de comunicação. Confira o status antes de tentar novamente."
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
            Entre ou crie sua conta para contratar a assinatura e acompanhar
            seu acesso Premium.
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
            Cobrança recorrente mensal, sem prazo predeterminado, conforme
            as condições apresentadas pelo Mercado Pago antes da contratação.
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
              {new Date(
                subscription.currentPeriodEnd
              ).toLocaleString("pt-BR")}
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
            <h2>Contratar Premium</h2>
            <p>
              Preencha os dados do cartão para autorizar a cobrança recorrente
              de R$ 19,90 por mês. O acesso Premium só será liberado após a
              confirmação necessária pelo servidor.
            </p>

            {!publicKey && (
              <p className="auth-error" role="alert">
                A configuração pública do Mercado Pago não está disponível.
                Entre em contato com o suporte.
              </p>
            )}

            {checkoutError && (
              <p className="auth-error" role="alert">
                {checkoutError}
              </p>
            )}

            <form id="form-checkout" className="subscription-card-form">
              <div>
                <label htmlFor="form-checkout__cardholderName">
                  Nome impresso no cartão
                </label>
                <input
                  id="form-checkout__cardholderName"
                  type="text"
                  autoComplete="cc-name"
                  placeholder="Nome como aparece no cartão"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-checkout__cardholderEmail">
                  E-mail do titular
                </label>
                <input
                  id="form-checkout__cardholderEmail"
                  type="email"
                  autoComplete="email"
                  defaultValue={user.email ?? ""}
                  required
                />
              </div>

              <div>
                <label htmlFor="form-checkout__cardNumber">
                  Número do cartão
                </label>
                <input
                  id="form-checkout__cardNumber"
                  type="text"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="Número do cartão"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-checkout__expirationDate">
                  Validade (MM/AA)
                </label>
                <input
                  id="form-checkout__expirationDate"
                  type="text"
                  autoComplete="cc-exp"
                  placeholder="MM/AA"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-checkout__securityCode">
                  Código de segurança
                </label>
                <input
                  id="form-checkout__securityCode"
                  type="password"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder="CVV"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-checkout__identificationType">
                  Tipo de documento
                </label>
                <select
                  id="form-checkout__identificationType"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                </select>
              </div>

              <div>
                <label htmlFor="form-checkout__identificationNumber">
                  Número do documento
                </label>
                <input
                  id="form-checkout__identificationNumber"
                  type="text"
                  inputMode="numeric"
                  placeholder="CPF ou documento solicitado"
                  required
                />
              </div>

              <div>
                <label htmlFor="form-checkout__issuer">
                  Banco emissor
                </label>
                <select id="form-checkout__issuer" defaultValue="">
                  <option value="">Selecione, se solicitado</option>
                </select>
              </div>

              <div>
                <label htmlFor="form-checkout__installments">
                  Parcelas
                </label>
                <select id="form-checkout__installments" defaultValue="">
                  <option value="">Selecione, se solicitado</option>
                </select>
              </div>

              <button
                className="primary-button"
                type="submit"
                disabled={
                  !publicKey ||
                  !cardFormReady ||
                  checkoutLoading ||
                  cancelLoading
                }
              >
                {checkoutLoading
                  ? "PROCESSANDO..."
                  : cardFormReady
                    ? "AUTORIZAR ASSINATURA — R$ 19,90/MÊS"
                    : "CARREGANDO FORMULÁRIO..."}
              </button>

              <p>
                Os dados do cartão são tratados pelo formulário do Mercado
                Pago. O aplicativo não armazena o número completo nem o código
                de segurança do cartão.
              </p>
            </form>
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
