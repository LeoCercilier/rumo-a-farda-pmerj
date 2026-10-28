
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

const styles = `
  .subscription-page {
    box-sizing: border-box;
    min-height: 100vh;
    padding: 32px 16px 48px;
    color: #f1f5f9;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(22, 101, 52, .18), transparent 55%),
      #080d16;
  }

  .subscription-page *,
  .subscription-page *::before,
  .subscription-page *::after {
    box-sizing: border-box;
  }

  .subscription-shell {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
  }

  .subscription-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
  }

  .subscription-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #f8fafc;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: .02em;
  }

  .subscription-brand-mark {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(74, 222, 128, .35);
    border-radius: 12px;
    color: #86efac;
    background: rgba(22, 101, 52, .18);
    font-size: 18px;
  }

  .subscription-back {
    color: #cbd5e1;
    font-size: 13px;
    text-decoration: none;
  }

  .subscription-back:hover {
    color: #86efac;
  }

  .subscription-hero {
    margin-bottom: 22px;
  }

  .subscription-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 10px;
    color: #86efac;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  .subscription-eyebrow::before {
    width: 18px;
    height: 2px;
    background: #4ade80;
    content: "";
  }

  .subscription-title {
    margin: 0;
    color: #f8fafc;
    font-size: clamp(27px, 5vw, 38px);
    font-weight: 850;
    line-height: 1.12;
    letter-spacing: -.04em;
  }

  .subscription-subtitle {
    max-width: 560px;
    margin: 12px 0 0;
    color: #a8b4c7;
    font-size: 14px;
    line-height: 1.7;
  }

  .subscription-card {
    margin-top: 16px;
    padding: 22px;
    border: 1px solid #263447;
    border-radius: 20px;
    background: #101827;
    box-shadow: 0 14px 40px rgba(0, 0, 0, .16);
  }

  .subscription-plan {
    position: relative;
    overflow: hidden;
    border-color: rgba(74, 222, 128, .3);
    background:
      linear-gradient(125deg, rgba(22, 101, 52, .22), transparent 70%),
      #101827;
  }

  .subscription-plan::after {
    position: absolute;
    top: -40px;
    right: -25px;
    width: 130px;
    height: 130px;
    border: 1px solid rgba(74, 222, 128, .12);
    border-radius: 50%;
    box-shadow: 0 0 0 18px rgba(74, 222, 128, .025),
      0 0 0 38px rgba(74, 222, 128, .02);
    content: "";
    pointer-events: none;
  }

  .subscription-plan-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .subscription-plan-name {
    margin: 0;
    color: #f8fafc;
    font-size: 17px;
    font-weight: 800;
  }

  .subscription-plan-description {
    margin: 7px 0 0;
    color: #a8b4c7;
    font-size: 13px;
    line-height: 1.6;
  }

  .subscription-plan-badge {
    flex-shrink: 0;
    padding: 6px 9px;
    border: 1px solid rgba(74, 222, 128, .25);
    border-radius: 999px;
    color: #86efac;
    background: rgba(22, 101, 52, .2);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .06em;
  }

  .subscription-price {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 22px;
  }

  .subscription-price-value {
    color: #fff;
    font-size: clamp(34px, 7vw, 44px);
    font-weight: 850;
    line-height: 1;
    letter-spacing: -.04em;
  }

  .subscription-price-period {
    color: #a8b4c7;
    font-size: 13px;
  }

  .subscription-plan-note {
    margin: 12px 0 0;
    padding-top: 12px;
    border-top: 1px solid #263447;
    color: #a8b4c7;
    font-size: 12px;
    line-height: 1.65;
  }

  .subscription-section-heading {
    display: flex;
    align-items: flex-start;
    gap: 13px;
    margin-bottom: 20px;
  }

  .subscription-step {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(74, 222, 128, .35);
    border-radius: 11px;
    color: #86efac;
    background: rgba(22, 101, 52, .17);
    font-size: 13px;
    font-weight: 800;
  }

  .subscription-section-title {
    margin: 1px 0 5px;
    color: #f8fafc;
    font-size: 17px;
    font-weight: 800;
  }

  .subscription-section-description {
    margin: 0;
    color: #94a3b8;
    font-size: 12px;
    line-height: 1.6;
  }

  .subscription-account {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    margin-bottom: 17px;
    padding: 13px 14px;
    border: 1px solid #263447;
    border-radius: 12px;
    background: #0b1220;
  }

  .subscription-account-icon {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    color: #cbd5e1;
    background: #1e293b;
    font-size: 15px;
  }

  .subscription-account-label {
    margin: 0 0 3px;
    color: #94a3b8;
    font-size: 11px;
  }

  .subscription-account-email {
    overflow-wrap: anywhere;
    margin: 0;
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 650;
  }

  .subscription-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 17px 14px;
  }

  .subscription-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 8px;
  }

  .subscription-field-wide {
    grid-column: 1 / -1;
  }

  .subscription-field label {
    color: #dbe4f0;
    font-size: 12px;
    font-weight: 700;
  }

  .subscription-field input,
  .subscription-field select {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 47px;
    padding: 0 13px;
    border: 1px solid #344256;
    border-radius: 10px;
    outline: none;
    color: #f8fafc;
    background: #0b1220;
    font: inherit;
    font-size: 14px;
    transition: border-color .15s ease, box-shadow .15s ease;
  }

  .subscription-field input::placeholder {
    color: #64748b;
  }

  .subscription-field input:focus,
  .subscription-field select:focus {
    border-color: #4ade80;
    box-shadow: 0 0 0 3px rgba(74, 222, 128, .11);
  }

  .subscription-field select:invalid {
    color: #94a3b8;
  }

  .subscription-field-hint {
    margin: -2px 0 0;
    color: #94a3b8;
    font-size: 11px;
    line-height: 1.5;
  }

  .subscription-form-divider {
    grid-column: 1 / -1;
    height: 1px;
    margin: 2px 0;
    background: #263447;
  }

  .subscription-form-subheading {
    grid-column: 1 / -1;
    margin: 0;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: .04em;
  }

  .subscription-primary-button,
  .subscription-secondary-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    min-height: 47px;
    padding: 12px 16px;
    border: 1px solid transparent;
    border-radius: 11px;
    font: inherit;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: .035em;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    transition: transform .15s ease, background .15s ease, opacity .15s ease;
  }

  .subscription-primary-button {
    color: #052e16;
    background: #4ade80;
  }

  .subscription-primary-button:hover:not(:disabled) {
    background: #86efac;
    transform: translateY(-1px);
  }

  .subscription-secondary-button {
    border-color: #344256;
    color: #e2e8f0;
    background: #172235;
  }

  .subscription-secondary-button:hover:not(:disabled) {
    background: #223149;
  }

  .subscription-primary-button:disabled,
  .subscription-secondary-button:disabled {
    opacity: .5;
    cursor: not-allowed;
  }

  .subscription-submit {
    grid-column: 1 / -1;
    width: 100%;
    min-height: 52px;
    margin-top: 2px;
    font-size: 13px;
  }

  /* Aviso de segurança corrigido: conteúdo contido e quebra de linha. */
  .subscription-secure-note {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    grid-column: 1 / -1;
    margin: 0;
    padding: 12px 13px;
    border: 1px solid #263447;
    border-radius: 10px;
    color: #94a3b8;
    background: #0b1220;
    font-size: 11px;
    line-height: 1.7;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .subscription-secure-note span {
    display: block;
    min-width: 0;
    max-width: 100%;
  }

  .subscription-secure-note span:first-child {
    color: #86efac;
    font-size: 14px;
    font-weight: 800;
    line-height: 1.5;
    text-align: center;
  }

  .subscription-secure-note span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .subscription-alert {
    margin: 0 0 16px;
    padding: 13px 14px;
    border: 1px solid #475569;
    border-radius: 11px;
    color: #e2e8f0;
    background: #172235;
    font-size: 13px;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }

  .subscription-alert-error {
    border-color: rgba(248, 113, 113, .35);
    color: #fecaca;
    background: rgba(127, 29, 29, .18);
  }

  .subscription-alert-success {
    border-color: rgba(74, 222, 128, .3);
    color: #bbf7d0;
    background: rgba(22, 101, 52, .17);
  }

  .subscription-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid #263447;
  }

  .subscription-status-row:last-of-type {
    border-bottom: 0;
  }

  .subscription-status-label {
    color: #94a3b8;
    font-size: 12px;
  }

  .subscription-status-value {
    overflow-wrap: anywhere;
    color: #e2e8f0;
    font-size: 13px;
    font-weight: 750;
    text-align: right;
  }

  .subscription-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    border: 1px solid #475569;
    border-radius: 999px;
    color: #cbd5e1;
    background: #172235;
    font-size: 11px;
    font-weight: 800;
  }

  .subscription-status-pill::before {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #94a3b8;
    content: "";
  }

  .subscription-status-pill-active {
    border-color: rgba(74, 222, 128, .3);
    color: #86efac;
    background: rgba(22, 101, 52, .17);
  }

  .subscription-status-pill-active::before {
    background: #4ade80;
  }

  .subscription-status-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 17px;
  }

  .subscription-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 22px;
    color: #94a3b8;
    font-size: 12px;
  }

  .subscription-footer a,
  .subscription-footer button {
    color: #cbd5e1;
    text-decoration: none;
  }

  .subscription-footer a:hover,
  .subscription-footer button:hover {
    color: #86efac;
  }

  .subscription-footer button {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
  }

  .subscription-footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }

  @media (max-width: 520px) {
    .subscription-page {
      padding: 20px 12px 32px;
    }

    .subscription-topline {
      margin-bottom: 27px;
    }

    .subscription-brand {
      font-size: 12px;
    }

    .subscription-brand-mark {
      width: 34px;
      height: 34px;
    }

    .subscription-card {
      padding: 17px 14px;
      border-radius: 16px;
    }

    .subscription-plan-top {
      gap: 8px;
    }

    .subscription-plan-badge {
      padding: 5px 7px;
      font-size: 9px;
    }

    .subscription-form {
      grid-template-columns: minmax(0, 1fr);
      gap: 15px;
    }

    .subscription-field-wide,
    .subscription-form-divider,
    .subscription-form-subheading,
    .subscription-submit,
    .subscription-secure-note {
      grid-column: 1;
    }

    .subscription-field input,
    .subscription-field select {
      height: 49px;
      font-size: 16px;
    }

    .subscription-status-actions > button {
      width: 100%;
    }

    .subscription-footer {
      align-items: flex-start;
      flex-direction: column;
    }
  }
`;

function AssinaturaContent() {
  const {
    user,
    loading,
    subscription,
    refreshSubscription,
    signOut,
  } = useAuth();

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
      <main className="subscription-page">
        <style jsx global>{styles}</style>
        <div className="subscription-shell">
          <section className="subscription-card">
            Carregando sua conta...
          </section>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="subscription-page">
        <style jsx global>{styles}</style>
        <div className="subscription-shell">
          <header className="subscription-topline">
            <div className="subscription-brand">
              <span className="subscription-brand-mark">RF</span>
              RUMO À FARDA
            </div>
            <Link className="subscription-back" href="/">
              Voltar ao início
            </Link>
          </header>

          <section className="subscription-card">
            <span className="subscription-eyebrow">ÁREA PREMIUM</span>
            <h1 className="subscription-title">
              Sua preparação começa aqui.
            </h1>
            <p className="subscription-subtitle">
              Entre ou crie sua conta para contratar a assinatura e acompanhar
              seu acesso Premium.
            </p>

            <div className="subscription-plan subscription-card">
              <h2 className="subscription-plan-name">
                Rumo à Farda Premium
              </h2>
              <div className="subscription-price">
                <span className="subscription-price-value">
                  R$ 19,90
                </span>
                <span className="subscription-price-period">/ mês</span>
              </div>
            </div>

            <div className="subscription-status-actions">
              <Link className="subscription-primary-button" href="/login">
                ENTRAR NA MINHA CONTA
              </Link>
              <Link className="subscription-secondary-button" href="/cadastro">
                CRIAR CONTA
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const hasAccess = subscription?.hasAccess === true;
  const status = subscription?.status ?? "none";
  const canCancel = status === "active" || status === "pending";

  return (
    <main className="subscription-page">
      <style jsx global>{styles}</style>

      <div className="subscription-shell">
        <header className="subscription-topline">
          <div className="subscription-brand">
            <span className="subscription-brand-mark">RF</span>
            RUMO À FARDA
          </div>
          <Link className="subscription-back" href="/">
            ← Voltar ao app
          </Link>
        </header>

        <section className="subscription-hero">
          <span className="subscription-eyebrow">SUA CONTA</span>
          <h1 className="subscription-title">Rumo à Farda Premium</h1>
          <p className="subscription-subtitle">
            Gerencie sua assinatura com segurança e acompanhe o status do
            seu acesso em um só lugar.
          </p>
        </section>

        {notice && (
          <div
            className="subscription-alert subscription-alert-success"
            role="status"
          >
            {notice}
          </div>
        )}

        <section className="subscription-card subscription-plan">
          <div className="subscription-plan-top">
            <div>
              <h2 className="subscription-plan-name">
                Plano mensal Premium
              </h2>
              <p className="subscription-plan-description">
                Para manter sua preparação para Soldado PMERJ em dia.
              </p>
            </div>
            <span className="subscription-plan-badge">PREMIUM</span>
          </div>

          <div className="subscription-price">
            <span className="subscription-price-value">R$ 19,90</span>
            <span className="subscription-price-period">por mês</span>
          </div>

          <p className="subscription-plan-note">
            Cobrança recorrente mensal, sem prazo predeterminado. Confira
            todas as condições apresentadas pelo Mercado Pago antes de
            autorizar a contratação.
          </p>
        </section>

        <section className="subscription-card">
          <div className="subscription-section-heading">
            <span className="subscription-step">01</span>
            <div>
              <h2 className="subscription-section-title">
                Status da assinatura
              </h2>
              <p className="subscription-section-description">
                A situação atual do seu plano e do acesso Premium.
              </p>
            </div>
          </div>

          <div className="subscription-status-row">
            <span className="subscription-status-label">
              Estado da assinatura
            </span>
            <span
              className={`subscription-status-pill ${
                hasAccess ? "subscription-status-pill-active" : ""
              }`}
            >
              {status}
            </span>
          </div>

          <div className="subscription-status-row">
            <span className="subscription-status-label">Acesso Premium</span>
            <span className="subscription-status-value">
              {hasAccess ? "Liberado" : "Bloqueado"}
            </span>
          </div>

          {subscription?.currentPeriodEnd && (
            <div className="subscription-status-row">
              <span className="subscription-status-label">Válido até</span>
              <span className="subscription-status-value">
                {new Date(
                  subscription.currentPeriodEnd
                ).toLocaleString("pt-BR")}
              </span>
            </div>
          )}

          {subscription?.message && (
            <p className="subscription-plan-note">
              {subscription.message}
            </p>
          )}

          <div className="subscription-status-actions">
            <button
              className="subscription-secondary-button"
              type="button"
              disabled={cancelLoading || checkoutLoading}
              onClick={() => void refreshSubscription()}
            >
              ATUALIZAR STATUS
            </button>

            {canCancel && (
              <button
                className="subscription-secondary-button"
                type="button"
                disabled={cancelLoading || checkoutLoading}
                onClick={() => void cancelSubscription()}
              >
                {cancelLoading
                  ? "PROCESSANDO CANCELAMENTO..."
                  : "CANCELAR ASSINATURA"}
              </button>
            )}
          </div>

          {cancelError && (
            <div
              className="subscription-alert subscription-alert-error"
              role="alert"
              style={{ marginTop: 16, marginBottom: 0 }}
            >
              {cancelError}
            </div>
          )}

          {canCancel && (
            <p className="subscription-plan-note">
              O cancelamento será confirmado após a consulta ao Mercado Pago.
              Atualize o status para conferir a situação final.
            </p>
          )}
        </section>

        {!hasAccess && (
          <section className="subscription-card">
            <div className="subscription-section-heading">
              <span className="subscription-step">02</span>
              <div>
                <h2 className="subscription-section-title">
                  Dados para pagamento
                </h2>
                <p className="subscription-section-description">
                  Preencha os dados solicitados para autorizar a cobrança
                  recorrente mensal.
                </p>
              </div>
            </div>

            <div className="subscription-account">
              <span className="subscription-account-icon">✉</span>
              <div style={{ minWidth: 0 }}>
                <p className="subscription-account-label">
                  Conta vinculada à assinatura
                </p>
                <p className="subscription-account-email">{user.email}</p>
              </div>
            </div>

            {!publicKey && (
              <div
                className="subscription-alert subscription-alert-error"
                role="alert"
              >
                A configuração pública do Mercado Pago não está disponível.
                Entre em contato com o suporte.
              </div>
            )}

            {checkoutError && (
              <div
                className="subscription-alert subscription-alert-error"
                role="alert"
              >
                {checkoutError}
              </div>
            )}

            <form id="form-checkout" className="subscription-form">
              <div className="subscription-field subscription-field-wide">
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

              <div className="subscription-field subscription-field-wide">
                <label htmlFor="form-checkout__cardholderEmail">
                  E-mail do titular
                </label>
                <input
                  id="form-checkout__cardholderEmail"
                  type="email"
                  autoComplete="email"
                  defaultValue={user.email ?? ""}
                  placeholder="E-mail do titular"
                  required
                />
              </div>

              <div className="subscription-form-divider" />

              <p className="subscription-form-subheading">
                DADOS DO CARTÃO
              </p>

              <div className="subscription-field subscription-field-wide">
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

              <div className="subscription-field">
                <label htmlFor="form-checkout__expirationDate">
                  Validade
                </label>
                <input
                  id="form-checkout__expirationDate"
                  type="text"
                  autoComplete="cc-exp"
                  placeholder="MM/AA"
                  required
                />
              </div>

              <div className="subscription-field">
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

              <div className="subscription-form-divider" />

              <p className="subscription-form-subheading">
                DADOS DO TITULAR
              </p>

              <div className="subscription-field">
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

              <div className="subscription-field">
                <label htmlFor="form-checkout__identificationNumber">
                  Número do documento
                </label>
                <input
                  id="form-checkout__identificationNumber"
                  type="text"
                  inputMode="numeric"
                  placeholder="CPF ou documento"
                  required
                />
              </div>

              <div className="subscription-field">
                <label htmlFor="form-checkout__issuer">
                  Banco emissor
                </label>
                <select id="form-checkout__issuer" defaultValue="">
                  <option value="">Selecione, se solicitado</option>
                </select>
              </div>

              <div className="subscription-field">
                <label htmlFor="form-checkout__installments">
                  Parcelas
                </label>
                <select id="form-checkout__installments" defaultValue="">
                  <option value="">Selecione, se solicitado</option>
                </select>
              </div>

              <button
                className="subscription-primary-button subscription-submit"
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
                    ? "AUTORIZAR ASSINATURA · R$ 19,90/MÊS"
                    : "CARREGANDO FORMULÁRIO..."}
              </button>

              <div className="subscription-secure-note" role="note">
                <span aria-hidden="true">✓</span>
                <span>
                  Os dados do cartão são tratados pelo formulário do
                  Mercado Pago. O aplicativo não armazena o número completo
                  nem o código de segurança do cartão. O acesso Premium
                  depende da confirmação necessária pelo servidor.
                </span>
              </div>
            </form>
          </section>
        )}

        <footer className="subscription-footer">
          <span>Rumo à Farda · Soldado PMERJ</span>
          <div className="subscription-footer-links">
            <Link href="/">Voltar ao app</Link>
            <button type="button" onClick={() => void signOut()}>
              Sair da conta
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}

export default function AssinaturaPage() {
  return (
    <Suspense
      fallback={
        <main className="subscription-page">
          <div className="subscription-shell">
            <section className="subscription-card">
              Carregando...
            </section>
          </div>
        </main>
      }
    >
      <AssinaturaContent />
    </Suspense>
  );
}
