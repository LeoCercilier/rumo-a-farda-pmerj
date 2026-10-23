# Instruções de implantação — Auth, Premium e Mercado Pago

Branch: `feat/auth-premium-access`

## 1. Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

| Variável | Onde | Obrigatória |
|----------|------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente + servidor | Sim |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cliente + servidor | Sim |
| `NEXT_PUBLIC_APP_URL` | Servidor (redirects) | Sim em produção |
| `SUPABASE_SERVICE_ROLE_KEY` | Somente servidor | Sim para webhook/pending |
| `MERCADOPAGO_ACCESS_TOKEN` | Somente servidor | Sim para checkout |
| `MERCADOPAGO_WEBHOOK_SECRET` | Somente servidor | Recomendado |
| `MERCADOPAGO_PLAN_ID` | Somente servidor | Quando o plano estiver criado no MP |

Nunca publique a service role nem o access token do Mercado Pago no frontend ou em repositório público.

## 2. Supabase (responsável separado)

Antes do premium funcionar de ponta a ponta:

1. Revisar `docs/CONTRATO_SUPABASE.md`
2. Revisar e aplicar (manualmente) o que for aprovado em `docs/SQL_PROPOSTO_NAO_EXECUTADO.sql`
3. **Crítico:** restringir leitura pública de `correct_option` e `explanation` em `questions`
4. Habilitar Auth e-mail/senha (e confirmação de e-mail, se desejado)
5. Configurar URL de redirect: `{APP_URL}/auth/callback`

## 3. Mercado Pago

1. Criar aplicação e obter Access Token de **teste**
2. Criar plano de assinatura (Preapproval Plan) e colocar o id em `MERCADOPAGO_PLAN_ID`
3. Configurar webhook apontando para `{APP_URL}/api/webhooks/mercadopago?secret=...`
4. Testar checkout em sandbox; **não** considerar URL de retorno como pagamento confirmado
5. Validar que o status só muda após o webhook

## 4. Build e deploy

```bash
npm install
npm run typecheck
npm run build
npm start
```

Deploy (ex.: Vercel): definir as variáveis de ambiente no painel; branch de produção só após review.

## 5. Rollback

```bash
git checkout main
# ou reverter o merge do PR da branch feat/auth-premium-access
```

Nenhuma migration automática foi aplicada neste trabalho; o banco original permanece intacto se o SQL proposto não tiver sido executado.
