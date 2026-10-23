"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${appUrl}/auth/callback?next=/` }
      );

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setMessage(
        "Se existir uma conta com este e-mail, enviaremos as instruções de recuperação."
      );
    } catch {
      setError("Não foi possível enviar o e-mail. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">RECUPERAÇÃO</span>
        <h1>Recuperar senha</h1>
        <p className="page-intro">
          Informe o e-mail da sua conta. Você receberá um link para redefinir a
          senha.
        </p>

        <form onSubmit={onSubmit} className="auth-form">
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-success">{message}</p>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Enviando..." : "ENVIAR LINK →"}
          </button>
        </form>

        <p className="auth-links">
          <Link href="/login">Voltar ao login</Link>
          {" · "}
          <Link href="/">Início</Link>
        </p>
      </section>
    </main>
  );
}
