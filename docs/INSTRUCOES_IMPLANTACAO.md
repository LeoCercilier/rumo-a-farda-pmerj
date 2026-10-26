
# Instruções de implantação — Rumo à Farda Premium

## 1. Estado atual e segurança

A assinatura comercial planejada é de **R$ 19,90 por mês**.

A cobrança deve permanecer desativada até concluir a configuração, os testes e a autorização expressa para habilitá-la.

- `BILLING_ENABLED=false`: mantém o checkout bloqueado.
- Não considerar o retorno do checkout como confirmação de pagamento.
- Não ativar questões automaticamente.
- Não executar alterações no banco sem aprovação explícita.
- Não publicar chaves secretas no GitHub ou no frontend.

Desenvolvimento e correções são feitos diretamente na branch `main`, com revisão de cada arquivo.

## 2. Variáveis de ambiente

Configurar em Vercel → Project → Settings → Environment Variables:

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública publishable do Supabase |
| `NEXT_PUBLIC_APP_URL` | URL oficial da aplicação |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso administrativo, somente no servidor |
| `MERCADOPAGO_ACCESS_TOKEN` | Token do Mercado Pago, somente no servidor |
| `MERCADOPAGO_WEBHOOK_SECRET` | Segredo de assinatura do webhook |
| `MERCADOPAGO_PLAN_ID` | ID técnico do plano recorrente |
| `BILLING_ENABLED` | `false` até a liberação expressa |

Usar a URL oficial de produção em `NEXT_PUBLIC_APP_URL`. Não incluir chaves ou tokens reais em arquivos versionados.

Depois de alterar variáveis na Vercel, gerar um novo deployment para que sejam aplicadas.

## 3. Supabase

Antes de liberar o acesso Premium:

1. Confirmar as variáveis de ambiente e o funcionamento do Supabase Auth.
2. Verificar os redirects de autenticação, incluindo `/auth/callback`.
3. Revisar as políticas RLS das tabelas de assinatura e questões.
4. Impedir que usuários não autorizados consultem respostas corretas e explicações diretamente pela API pública.
5. Confirmar que a API de questões entrega somente os campos permitidos e exige assinatura válida para verificar respostas Premium.

**Atenção:** a política pública de leitura de questões ativas pode expor `correct_option` e `explanation`. A proteção da API, isoladamente, não corrige uma exposição direta pelo banco.

O arquivo `docs/SQL_PROPOSTO_NAO_EXECUTADO.sql` contém propostas que precisam ser revisadas e aprovadas antes de qualquer execução. Não aplicar alterações automaticamente.

## 4. Mercado Pago

1. Confirmar o plano recorrente de R$ 19,90 por mês.
2. Obter o ID técnico do plano e configurar `MERCADOPAGO_PLAN_ID`. O link comercial de compartilhamento não substitui esse ID.
3. Usar credenciais de teste para validar o fluxo antes de qualquer cobrança real.
4. Configurar o webhook para:

   `https://rumo-a-farda-pmerj.vercel.app/api/webhooks/mercadopago`

5. Cadastrar no painel do Mercado Pago o segredo de webhook correspondente e configurar o mesmo valor em `MERCADOPAGO_WEBHOOK_SECRET`.
6. Não acrescentar o segredo como parâmetro da URL do webhook.
7. Validar a assinatura HMAC da notificação e processar os eventos de forma idempotente.
8. Confirmar o status da assinatura no servidor antes de liberar o acesso Premium.

A conta do Mercado Pago também pode ser utilizada por outros projetos, mas as URLs de webhook, os planos e as configurações de cada integração devem ser mantidos separados.

## 5. Validação antes da publicação

- [ ] Login, cadastro e recuperação de acesso testados.
- [ ] Usuário sem assinatura não acessa recursos Premium.
- [ ] Checkout bloqueado quando `BILLING_ENABLED=false`.
- [ ] Credenciais de teste configuradas no ambiente apropriado.
- [ ] Webhook validado com eventos de teste.
- [ ] Pagamento pendente ou cancelado não libera acesso indevidamente.
- [ ] Assinatura confirmada libera acesso conforme as regras do servidor.
- [ ] Exposição de respostas corretas pelo Supabase corrigida e testada.
- [ ] Build e verificação de tipos concluídos sem erros.

## 6. Liberação de cobrança

Não alterar `BILLING_ENABLED` para `true` até que os testes tenham sido concluídos, os bloqueios de segurança corrigidos e exista autorização expressa para habilitar cobranças.

## 7. Recuperação

Se uma atualização causar falha, identificar o commit responsável e usar a opção de reversão do próprio GitHub, revisando as alterações antes de confirmar. Preservar arquivos locais, backups e dados existentes.
