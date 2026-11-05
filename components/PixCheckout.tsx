
"use client";

import { useEffect, useRef, useState } from "react";

type PixPaymentData = {
  paymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string;
};

type Props = {
  onPaid: () => void | Promise<void>;
};

export default function PixCheckout({ onPaid }: Props) {
  const [payment, setPayment] = useState<PixPaymentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const paidRef = useRef(false);
  const onPaidRef = useRef(onPaid);

  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  async function createPayment() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/subscription/pix", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.message ||
            "Não foi possível gerar o Pix. Tente novamente mais tarde."
        );
        return;
      }

      if (
        !data.paymentId ||
        !data.qrCode ||
        data.status !== "pending"
      ) {
        setError(
          "O servidor não confirmou os dados do Pix. Atualize o status antes de tentar novamente."
        );
        return;
      }

      setPayment(data as PixPaymentData);
      setMessage(
        "Pix gerado. Após o pagamento, aguarde a confirmação automática."
      );
    } catch {
      setError(
        "Falha de comunicação ao gerar o Pix. Verifique sua conexão."
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyPixCode() {
    if (!payment?.qrCode) return;

    try {
      await navigator.clipboard.writeText(payment.qrCode);
      setCopied(true);
      setMessage("Código Pix copiado. Cole no aplicativo do seu banco.");
    } catch {
      setError(
        "Não foi possível copiar automaticamente. Selecione e copie o código Pix."
      );
    }
  }

  useEffect(() => {
    if (!payment || paidRef.current) return;

    let stopped = false;
    let checking = false;

    const checkStatus = async () => {
      if (stopped || checking || paidRef.current) return;

      checking = true;

      try {
        const response = await fetch("/api/subscription/status", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) return;

        const data = await response.json();

        if (data.hasAccess === true && !paidRef.current) {
          paidRef.current = true;
          setMessage("Pagamento confirmado! Seu acesso Premium foi liberado.");
          await onPaidRef.current();
        }
      } catch {
        // A próxima verificação automática tentará novamente.
      } finally {
        checking = false;
      }
    };

    void checkStatus();

    const interval = window.setInterval(() => {
      void checkStatus();
    }, 5000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [payment]);

  return (
    <section className="pix-checkout">
      <style jsx>{`
        .pix-checkout {
          margin-top: 22px;
          padding: 18px;
          border: 1px solid #31513f;
          border-radius: 14px;
          background: #0b1720;
        }

        .pix-title {
          margin: 0;
          color: #f8fafc;
          font-size: 16px;
          font-weight: 800;
        }

        .pix-description {
          margin: 8px 0 16px;
          color: #a8b4c7;
          font-size: 12px;
          line-height: 1.65;
        }

        .pix-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 48px;
          padding: 12px 16px;
          border: 0;
          border-radius: 10px;
          color: #052e16;
          background: #4ade80;
          font-size: 12px;
          font-weight: 850;
          cursor: pointer;
        }

        .pix-button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .pix-qr-area {
          display: flex;
          align-items: center;
          flex-direction: column;
          gap: 13px;
          margin-top: 18px;
          padding: 16px;
          border: 1px solid #263447;
          border-radius: 12px;
          background: #fff;
        }

        .pix-qr {
          display: block;
          width: 210px;
          max-width: 100%;
          height: auto;
          image-rendering: pixelated;
        }

        .pix-qr-label {
          margin: 0;
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
          text-align: center;
        }

        .pix-code {
          width: 100%;
          min-height: 90px;
          padding: 10px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          color: #0f172a;
          background: #f8fafc;
          font-size: 11px;
          line-height: 1.5;
          overflow-wrap: anywhere;
          resize: vertical;
        }

        .pix-secondary {
          width: 100%;
          min-height: 43px;
          padding: 10px;
          border: 1px solid #344256;
          border-radius: 9px;
          color: #e2e8f0;
          background: #172235;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }

        .pix-message,
        .pix-error {
          margin: 13px 0 0;
          font-size: 12px;
          line-height: 1.6;
          overflow-wrap: anywhere;
        }

        .pix-message {
          color: #86efac;
        }

        .pix-error {
          color: #fecaca;
        }

        .pix-expiration {
          margin: 10px 0 0;
          color: #64748b;
          font-size: 11px;
          text-align: center;
        }

        .pix-ticket {
          color: #86efac;
          font-size: 12px;
          text-decoration: underline;
        }
      `}</style>

      <h3 className="pix-title">Pagamento por Pix</h3>

      <p className="pix-description">
        Pague R$ 19,90 e tenha 30 dias de acesso Premium.
        O Pix é avulso: não existe renovação automática.
      </p>

      {!payment && (
        <button
          className="pix-button"
          type="button"
          onClick={() => void createPayment()}
          disabled={loading}
        >
          {loading ? "GERANDO PIX..." : "GERAR PIX · R$ 19,90"}
        </button>
      )}

      {payment && (
        <>
          {payment.qrCodeBase64 && (
            <div className="pix-qr-area">
              <p className="pix-qr-label">
                Escaneie o QR Code pelo aplicativo do seu banco
              </p>

              <img
                className="pix-qr"
                src={`data:image/png;base64,${payment.qrCodeBase64}`}
                alt="QR Code para pagamento Pix"
              />
            </div>
          )}

          <p className="pix-description" style={{ marginTop: 16 }}>
            Ou copie o código Pix abaixo:
          </p>

          <textarea
            className="pix-code"
            readOnly
            value={payment.qrCode}
            aria-label="Código Pix copia e cola"
          />

          <button
            className="pix-button"
            type="button"
            onClick={() => void copyPixCode()}
            style={{ marginTop: 10 }}
          >
            {copied ? "CÓDIGO COPIADO" : "COPIAR CÓDIGO PIX"}
          </button>

          {payment.ticketUrl && (
            <p style={{ textAlign: "center", marginTop: 13 }}>
              <a
                className="pix-ticket"
                href={payment.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir página do pagamento
              </a>
            </p>
          )}

          <p className="pix-expiration">
            Expiração:{" "}
            {new Date(payment.expiresAt).toLocaleString("pt-BR")}
          </p>

          <p className="pix-description" style={{ marginBottom: 0 }}>
            Estamos verificando o pagamento automaticamente. Não é necessário
            enviar comprovante.
          </p>
        </>
      )}

      {message && (
        <p className="pix-message" role="status">
          {message}
        </p>
      )}

      {error && (
        <p className="pix-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
