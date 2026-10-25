-- Rumo à Farda PMERJ
-- Registro persistente de eventos do webhook Mercado Pago.
-- Preparação: não executar no Supabase sem revisão.

CREATE TABLE public.subscription_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  event_key text NOT NULL UNIQUE,
  notification_type text NOT NULL,
  notification_action text,
  resource_id text NOT NULL,
  request_id text,

  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),

  attempts integer NOT NULL DEFAULT 1
    CHECK (attempts >= 1),

  payload jsonb,
  last_error_code text,

  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_webhook_events_processed_check
    CHECK (
      status <> 'processed'
      OR processed_at IS NOT NULL
    )
);

COMMENT ON TABLE public.subscription_webhook_events IS
  'Registro idempotente e auditável de notificações recebidas do Mercado Pago.';

COMMENT ON COLUMN public.subscription_webhook_events.event_key IS
  'Impressão digital estável usada para reconhecer notificações repetidas.';

COMMENT ON COLUMN public.subscription_webhook_events.status IS
  'Estado do processamento: processing, processed ou failed.';

COMMENT ON COLUMN public.subscription_webhook_events.attempts IS
  'Quantidade de tentativas de processamento registradas.';

ALTER TABLE public.subscription_webhook_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.subscription_webhook_events
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.subscription_webhook_events
  TO service_role;

CREATE INDEX subscription_webhook_events_status_received_idx
  ON public.subscription_webhook_events (status, received_at DESC);

CREATE INDEX subscription_webhook_events_resource_idx
  ON public.subscription_webhook_events (resource_id, notification_type);
