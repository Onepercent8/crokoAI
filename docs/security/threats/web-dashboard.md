# Threat model (STRIDE) — Dashboard web (Onda 6)

- **Superfície:** app Next.js 15 (`web/`) hospedado no Vercel; rotas de página + API
  Hono em `app/api/[[...route]]/route.ts`; endpoint público de login `POST /api/auth/login`.
  É a **única** borda HTTP autenticada do sistema (operador único).
- **Spec/ADR:** [web-dashboard-nexus](../../specs/web-dashboard-nexus.md) · [ADR 0005](../../adr/0005-dashboard-vercel.md) · [ADR 0006](../../adr/0006-auth-do-dashboard.md)
- **Fonte:** SPEC-000 §8 Onda 6 · §11 (STRIDE por superfície nova) · `.claude/rules/security.md`

## Ativos

- Leituras server-side de **todas** as tabelas via `SUPABASE_SECRET_KEY` (service_role):
  clientes, campanhas, análises, funil, logs.
- Sessão do operador (JWT HS256 assinado com `AUTH_SECRET`).
- Segredos: `SUPABASE_SECRET_KEY`, `AUTH_SECRET`, `DASHBOARD_PASSWORD` (hash),
  `UPSTASH_REDIS_REST_URL/TOKEN`, `TURNSTILE_SECRET_KEY` (opcional) — env do Vercel.

## Fronteira / fluxo

Browser → `middleware.ts` (**auth**: valida JWT + injeta nonce + headers) → handler
(**authz** operador → **validação** Zod → **lógica**). Leituras de tabela são
**server-side** (RLS fechada ao browser; o browser nunca fala com o Supabase). Sem
chamada inbound a runner/Worker (SPEC-000 §3) — o dashboard só lê o banco e enfileira
`agent_jobs`.

## STRIDE

| Categoria | Ameaça | Mitigação | Onde |
|---|---|---|---|
| **S**poofing | Forjar cookie de sessão para se passar pelo operador | JWT HS256 verificado por `verifySession` (assinatura + `exp` + `sub=operator`); cookie `HttpOnly`+`Secure`+`SameSite=Strict`; rota não-pública sem sessão válida → `401`/redirect. | `lib/auth/session.ts`, `middleware.ts` |
| **T**ampering | Adulterar payload do JWT ou injetar HTML/JS na página | Assinatura HS256 rejeita qualquer mutação do token; CSP por nonce (sem `unsafe-inline`, `strict-dynamic`) + `X-Content-Type-Options: nosniff` + `base-uri 'self'`; entrada validada por Zod antes da lógica. | `lib/security-headers.ts`, `lib/auth/session.ts` |
| **R**epudiation | Ação de mutação sem rastro | Dashboard **não muta** a Meta/banco diretamente: só enfileira `agent_jobs` (`requested_by`), e o runner grava `operation_logs`/`agent_events` append-only (ver threat model da camada de dados). | `agent_jobs` (Onda 3), `operation_logs` |
| **I**nfo disclosure | Vazar segredo ao browser ou PII em resposta/log | `SUPABASE_SECRET_KEY` só server-side (`import 'server-only'` em `lib/ratelimit.ts`/serviços); `NEXT_PUBLIC_*` nunca carrega segredo; `Referrer-Policy: no-referrer`; leituras tipadas que não ecoam segredo; sem PII em log. | `lib/env.ts`, `lib/services/*` |
| **D**oS | Brute-force/flood no login ou nos endpoints que custam dinheiro | Rate limit Upstash no login (5/min por IP) e no Nexus (30/min por sessão); edge da Vercel absorve volume; Turnstile opcional no login. | `lib/ratelimit.ts`, `lib/auth/turnstile.ts` |
| **E**levation | Acesso a rota protegida sem sessão; clickjacking | Gate de sessão no `middleware` antes de qualquer handler (`auth → authz → validação`); `X-Frame-Options: DENY` + `frame-ancestors 'none'`; `Permissions-Policy` desliga câmera/mic/geo por padrão. | `middleware.ts`, `lib/security-headers.ts` |

## Riscos residuais / follow-ups

- **Senha do login na URL (achado em 2026-06-23, ver NOTES §7/W6):** o `login-form`
  degradava para GET nativo sem JS, vazando a senha na URL. **Corrigido** (degrada para
  `method=POST`); **rotacionar** a `DASHBOARD_PASSWORD` de teste já usada continua pendente.
- `AUTH_SECRET` deve ter ≥ 32 bytes de entropia; comprometê-lo permite forjar sessão.
  Rotação periódica via secrets do Vercel, nunca no código.
- Operador único nesta fase (`sub=operator`); multi-usuário/RBAC fica para fase posterior.
- `connect-src 'self'` na CSP assume que toda chamada do browser passa pela API própria;
  revisar se uma integração futura exigir origem externa.
</content>
