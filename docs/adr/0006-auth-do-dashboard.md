# ADR 0006 — Auth do dashboard

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 6

## Contexto

O dashboard é a única superfície HTTP com usuário humano do sistema (SPEC-000 §3). Ele dá acesso a
dados sensíveis de operação (gasto de campanhas, métricas de funil, logs) e — via fila `agent_jobs`
— ao poder de criar/ativar campanhas (gasto real). Tem **um único operador** (o dono da agência),
não é multi-tenant de usuários finais. Portanto não precisamos de cadastro/recuperação de senha/SSO;
precisamos de uma barreira forte, simples e sem servidor de sessão.

Requisitos (SPEC-000 §8 Onda 6, §10, §11 + `.claude/rules/security.md`):

- **Ordem obrigatória** em toda rota protegida: `auth → authz → validação → lógica`.
- **Sem segredos no código**: senha como **hash** (`DASHBOARD_PASSWORD` = SHA-256 da senha),
  `AUTH_SECRET` (≥32 bytes) para assinar a sessão. Fonte: env do Vercel / `.env.local`.
- **Rate limit no login** (Upstash) contra brute force.
- **Turnstile (Cloudflare) opcional** como anti-bot no login quando as chaves estiverem presentes.
- Sessão sem store: o dashboard é serverless/stateless (ver [ADR 0005](0005-dashboard-vercel.md)).

Alternativas consideradas:

1. **Supabase Auth (GoTrue) com usuários.** Excelente para multi-tenant, mas overkill para um único
   operador; traria tabelas/policies de auth e expandiria a superfície (a RLS é deny-by-default e o
   dashboard já fala com o banco via `service_role`). Rejeitada para esta fase.
2. **Sessão server-side em Redis/Postgres (cookie opaco).** Exige store e invalidação; ganho baixo
   para um operador. Preterida.
3. **Senha (hash) → cookie JWT assinado com `AUTH_SECRET`, HttpOnly/Secure/SameSite, com rate limit
   e Turnstile opcional.** Escolhida.

## Decisão

Autenticação por **senha única comparada contra `DASHBOARD_PASSWORD` (hash SHA-256)**, que emite um
**cookie de sessão JWT assinado com `AUTH_SECRET`**. Detalhes:

- **Login** (`POST /api/auth/login`): ordem `rate limit (Upstash por IP) → Turnstile (se configurado)
  → validação Zod do corpo → comparação de hash`. Comparação **em tempo constante** do digest; em
  sucesso, set-cookie JWT **HttpOnly + Secure + SameSite=Strict**, expiração curta. Falha responde
  genérico (sem distinguir "senha errada" de "rate-limited" além do status).
- **Gate de sessão** no `middleware.ts`: verifica a assinatura/expiração do JWT antes de servir
  qualquer rota protegida; sem sessão válida → redirect para `/login` (páginas) ou `401` (API).
  É a etapa **auth**; a **authz** (operador único = acesso total às rotas de operação) e a
  **validação** (Zod) acontecem no handler, antes da lógica.
- **Logout** limpa o cookie. **Sem confirmação livre `confirm=true`** em mutações (as escritas reais
  são via `agent_jobs`; o Nexus, Onda 7, exige confirmação em dois turnos).
- Os mesmos **headers de segurança + CSP por nonce** do [ADR 0005](0005-dashboard-vercel.md) valem em
  todas as respostas, inclusive nas de auth.

Esboço de contrato (referência; o DDL/handler é a implementação da Onda 6):

```ts
const LoginBody = z.object({
  password: z.string().min(1).max(512),
  turnstileToken: z.string().optional(),
});
```

## Consequências

- **+** Stateless: JWT assinado dispensa store de sessão, alinhado ao runtime serverless do Vercel.
- **+** Senha só existe como hash em env; nunca em texto no código nem no banco.
- **+** Rate limit + Turnstile + comparação em tempo constante endurecem o login contra brute force
  e bots.
- **+** Cookie HttpOnly/Secure/SameSite=Strict mitiga XSS-roubo-de-token e CSRF.
- **−** Senha única, não revogável por usuário: vazou → trocar `DASHBOARD_PASSWORD`; rotação de
  `AUTH_SECRET` invalida todas as sessões (aceitável para 1 operador).
- **−** JWT não tem revogação granular antes de expirar; mitigado por expiração curta.
- **−** Não cobre multi-operador/RBAC; se a agência crescer, migrar para Supabase Auth + policies
  (nova ADR).
