"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signError) {
        setError(signError.message);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="eyebrow">ACESSO</span>
        <h1>Entrar</h1>
        <p className="page-intro">
          Acesse sua conta para estudar com questões, simulados e acompanhamento.
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
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "ENTRAR →"}
          </button>
        </form>

        <p className="auth-links">
          <Link href="/recuperar-senha">Esqueci a senha</Link>
          {" · "}
          <Link href="/cadastro">Criar conta</Link>
          {" · "}
          <Link href="/">Voltar ao início</Link>
        </p>
      </section>
    </main>
  );
}
