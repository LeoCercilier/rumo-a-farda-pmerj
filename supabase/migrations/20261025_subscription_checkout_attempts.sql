
-- Rumo à Farda PMERJ
-- Preparação do controle de tentativas de checkout.
-- Esta migração deve ser revisada antes de ser executada no Supabase.

CREATE TABLE public.subscription_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL
    REFERENCES auth.users (id)
    ON DELETE CASCADE,

  idempotency_key text NOT NULL UNIQUE,
  external_reference text NOT NULL UNIQUE,

  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'failed')),

  mp_preapproval_id text UNIQUE,
  checkout_url text,

  lease_expires_at timestamptz NOT NULL DEFAULT now(),

  last_error_code text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_checkout_attempts_user_id_key
    UNIQUE (user_id),

  CONSTRAINT subscription_checkout_attempts_completed_data_check
    CHECK (
      status <> 'pending'
      OR (
        mp_preapproval_id IS NOT NULL
        AND checkout_url IS NOT NULL
      )
    )
);

COMMENT ON TABLE public.subscription_checkout_attempts IS
  'Controle persistente das tentativas de checkout do Mercado Pago.';

COMMENT ON COLUMN public.subscription_checkout_attempts.idempotency_key IS
  'Chave persistente reutilizada nas repetições da mesma tentativa.';

COMMENT ON COLUMN public.subscription_checkout_attempts.external_reference IS
  'Referência externa única associada à tentativa de checkout.';

COMMENT ON COLUMN public.subscription_checkout_attempts.lease_expires_at IS
  'Prazo de reserva da tentativa; não autoriza criar outra assinatura automaticamente.';

ALTER TABLE public.subscription_checkout_attempts
  ENABLE ROW LEVEL SECURITY;

-- A tabela será acessada pelo servidor com a service role.
-- Não conceder acesso direto a anon ou authenticated.
REVOKE ALL ON TABLE public.subscription_checkout_attempts
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.subscription_checkout_attempts
  TO service_role;

CREATE INDEX subscription_checkout_attempts_status_lease_idx
  ON public.subscription_checkout_attempts (status, lease_expires_at);

CREATE INDEX subscription_checkout_attempts_created_at_idx
  ON public.subscription_checkout_attempts (created_at DESC);
