# Contrato de Integração — Frontend ↔ Supabase

**Status:** Proposta de contrato. Nenhuma tabela, política ou função abaixo foi criada ou alterada por este agente. Tudo depende do responsável pelo Supabase.

**Data:** 2026-10-23  
**Repositório:** LeoCercilier/rumo-a-farda-pmerj  
**Branch de trabalho:** `feat/auth-premium-access`

---

## 1. Identificação do usuário autenticado

O frontend utiliza **Supabase Auth** (e-mail/senha).

Dados mínimos usados pelo código:

| Campo | Origem | Uso |
|-------|--------|-----|
| `user.id` (UUID) | `auth.users` via sessão | Identificar o assinante |
| `user.email` | sessão | Exibição e recuperação de senha |
| Access token / refresh | cookie httpOnly (via `@supabase/ssr`) | Validar sessão no servidor |

A sessão é gerenciada com cookies seguros (`@supabase/ssr`). O frontend **não** armazena tokens de longa duração em `localStorage`.

---

## 2. Informação mínima que o frontend precisa para saber se há acesso

Resposta do endpoint `GET /api/subscription/status` (ou equivalente):

```json
{
  "authenticated": true,
  "hasAccess": false,
  "status": "none" | "pending" | "active" | "past_due" | "cancelled" | "expired" | "rejected",
  "currentPeriodEnd": "2026-11-23T00:00:00.000Z" | null,
  "planId": "string" | null,
  "message": "string opcional para UI"
}
```

- **`hasAccess === true`** somente quando `status === "active"` e (se existir) `currentPeriodEnd` ainda no futuro.
- Qualquer outro status → sem acesso a gabaritos, explicações, simulados com correção e conteúdo premium.

---

## 3. Estrutura proposta para o estado da assinatura

### 3.1 Tabela proposta: `public.subscriptions` (NOVA — ainda não existe)

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | default `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | FK → `auth.users(id)` ON DELETE CASCADE |
| `status` | text NOT NULL | ver estados abaixo |
| `mp_subscription_id` | text UNIQUE | ID da assinatura no Mercado Pago |
| `mp_preapproval_id` | text | se usar Preapproval |
| `plan_id` | text | identificador interno do plano |
| `current_period_start` | timestamptz | |
| `current_period_end` | timestamptz | |
| `cancelled_at` | timestamptz | |
| `raw_payload` | jsonb | último evento relevante (opcional, para auditoria) |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

Índice sugerido: `(user_id)` e `(mp_subscription_id)`.

### 3.2 Tabela proposta: `public.profiles` (NOVA — recomendada)

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | = `auth.users.id` |
| `email` | text | |
| `full_name` | text | opcional |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Trigger sugerido: criar profile ao inserir em `auth.users`.

### 3.3 Estados da assinatura e acesso

| Status | Concede acesso premium? | Descrição |
|--------|-------------------------|-----------|
| `none` | Não | Usuário sem registro de assinatura |
| `pending` | Não | Checkout iniciado; aguardando confirmação do webhook |
| `active` | **Sim** | Pagamento confirmado e período vigente |
| `past_due` | Não (ou grace period, a definir) | Falha de cobrança recorrente |
| `cancelled` | Não (até fim do período pago, se aplicável) | Cancelada pelo usuário ou sistema |
| `expired` | Não | Período encerrado |
| `rejected` | Não | Pagamento recusado |

**Regra de ouro:** o frontend **nunca** define `status` ou `hasAccess`. Somente o backend (webhook Mercado Pago + service role / Edge Function) atualiza a tabela.

---

## 4. Endpoints / funções necessários

### 4.1 Já implementados no Next.js (este repositório)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/subscription/status` | Sessão do usuário | Consulta status da assinatura do usuário logado |
| POST | `/api/subscription/checkout` | Sessão do usuário | Cria preferência/preapproval no Mercado Pago e devolve URL de checkout |
| POST | `/api/webhooks/mercadopago` | Assinatura do webhook | Recebe notificações do MP (validação de autenticidade obrigatória) |
| GET | `/api/questions/bank` | Opcional | Retorna questões **sem** `correct_option`/`explanation` se sem acesso |
| POST | `/api/questions/check` | Sessão + assinatura ativa | Valida resposta e devolve feedback + explicação se autorizado |

### 4.2 Dependências no Supabase (a implementar pelo outro agente)

1. **Leitura segura da assinatura**  
   - Opção A: RLS em `subscriptions` permitindo `SELECT` apenas onde `user_id = auth.uid()`.  
   - Opção B: Edge Function / RPC `get_my_subscription()` que retorna apenas o status do usuário autenticado.

2. **Atualização da assinatura**  
   - Somente via **service_role** ou Edge Function com secret do webhook.  
   - Nunca permitir UPDATE/INSERT de `status` pelo cliente autenticado comum.

3. **Ajuste nas tabelas de conteúdo (CRÍTICO para segurança)**

   Hoje as políticas RLS de `questions` permitem leitura pública de `correct_option` e `explanation` para `anon` e `authenticated`.

   **Proposta (não executada):**

   - Criar view `public.questions_public` com colunas: `id, subject_id, topic_id, statement, options, difficulty, active` (**sem** gabarito).
   - Ou alterar a política de SELECT em `questions` para **não** expor `correct_option` e `explanation` a `anon` / usuários sem assinatura.
   - Criar RPC `check_question_answer(question_id uuid, selected_option text)` que:
     - exige usuário autenticado com assinatura `active`;
     - compara a opção;
     - retorna `{ correct: boolean, explanation: text, correct_option: text }`.

   Sem essa mudança no banco, um atacante pode consultar a API REST do Supabase diretamente e obter os gabaritos, independentemente do frontend.

---

## 5. Formato de requisição e resposta

### GET `/api/subscription/status`

- Headers: cookie de sessão Supabase  
- Resposta 200: objeto da seção 2  
- Resposta 401: `{ "authenticated": false, "hasAccess": false, "status": "none" }`

### POST `/api/subscription/checkout`

- Body (JSON): `{ "planId"?: string }` (opcional; plano default configurado no servidor)  
- Resposta 200: `{ "checkoutUrl": "https://...", "externalReference": "..." }`  
- Resposta 401/403/500 conforme o caso  
- **Não** ativa assinatura; apenas redireciona para o Mercado Pago.

### POST `/api/webhooks/mercadopago`

- Validar assinatura / secret do Mercado Pago antes de processar.  
- Idempotente: notificações duplicadas não devem corromper o estado.  
- Atualizar `subscriptions` com service role.  
- Responder 200 rapidamente após validação.

### GET `/api/questions/bank`

- Sem auth: questões sem gabarito (ou lista vazia / mensagem de login, conforme política de produto).  
- Com auth + `hasAccess`: ainda assim o banco idealmente não devolve gabarito no SELECT público; o gabarito só vem no `/check`.

### POST `/api/questions/check`

```json
// Request
{ "questionId": "uuid-ou-supabase:uuid", "selectedOption": "a" }

// Response 200 (autorizado)
{ "correct": true, "correctOption": "a", "explanation": "..." }

// Response 403
{ "error": "subscription_required", "message": "Assinatura ativa necessária." }
```

---

## 6. Regras de autorização esperadas

1. Sessão válida (JWT Supabase) obrigatória para checkout, status detalhado e correção de questões.  
2. `hasAccess` derivado **somente** de registro em `subscriptions` (ou view/RPC), nunca de body/query/localStorage.  
3. Webhook do Mercado Pago é a **única** fonte de verdade para ativar/renovar/cancelar.  
4. URL de retorno do checkout (`back_urls`) é apenas navegação; o frontend deve chamar `/api/subscription/status` após o retorno.  
5. Chaves `SUPABASE_SERVICE_ROLE_KEY` e tokens do Mercado Pago **apenas** em variáveis de servidor / Edge Functions.

---

## 7. Tratamento de estados

| Evento | Comportamento esperado no backend |
|--------|-----------------------------------|
| Checkout iniciado | Opcional: inserir `status = pending` |
| Webhook pagamento aprovado / assinatura autorizada | `status = active`, preencher `current_period_*` |
| Webhook pagamento recusado | `status = rejected` ou manter `pending` |
| Cobrança recorrente falhou | `status = past_due` |
| Cancelamento | `status = cancelled`; acesso até `current_period_end` se política de grace |
| Período expirado | `status = expired` (job ou verificação na leitura) |

---

## 8. Sincronização com webhooks

- Endpoint: `POST /api/webhooks/mercadopago` (ou Edge Function dedicada no Supabase).  
- Validar header/assinatura conforme documentação oficial do Mercado Pago.  
- Processar de forma idempotente (`mp_subscription_id` + event id).  
- Não confiar em query params de success/failure do browser.

---

## 9. Variáveis de ambiente necessárias

### Públicas (podem ir no cliente)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=https://seu-dominio.com
```

### Somente servidor (nunca no bundle do cliente)

```
SUPABASE_SERVICE_ROLE_KEY=
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_SECRET=
MERCADOPAGO_PLAN_ID=          # ou Preapproval plan id, quando definido
```

**Não colocar valores secretos neste repositório.**

---

## 10. SQL proposto (NÃO EXECUTADO)

O arquivo `docs/SQL_PROPOSTO_NAO_EXECUTADO.sql` contém scripts de referência.  
**Não execute automaticamente.** Revisar e aplicar apenas pelo responsável pelo Supabase.

---

## 11. Dúvidas que dependem do responsável pelo Supabase

1. Já existe alguma tabela de perfis ou assinaturas no projeto?  
2. Preferência por **Preapproval (assinaturas)** vs **Subscriptions API** do Mercado Pago?  
3. Grace period após cancelamento / `past_due`?  
4. As políticas RLS atuais de `questions` podem ser alteradas para remover exposição pública de `correct_option` e `explanation`?  
5. Haverá Edge Functions no Supabase ou o webhook ficará apenas na rota Next.js?  
6. Confirmação de e-mail obrigatória no cadastro?  
7. Preço, frequência e `plan_id` comerciais definitivos?

---

## 12. O que o frontend já faz / não faz

**Faz:**

- Auth (cadastro, login, logout, recuperação de senha) via Supabase Auth.  
- Consulta de status via API de servidor.  
- Checkout iniciado só no servidor.  
- Questões entregues sem gabarito até autorização.  
- Correção de resposta via endpoint autenticado.

**Não faz:**

- Não executa SQL.  
- Não ativa assinatura por URL de sucesso.  
- Não confia em `localStorage` para premium.  
- Não expõe service role nem access token do Mercado Pago no cliente.
