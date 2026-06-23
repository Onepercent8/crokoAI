# SPEC — Dashboard web (Vercel) + auth

- **Status:** draft
- **Onda:** 6
- **ADRs relacionados:** [0005](../adr/0005-dashboard-vercel.md) (dashboard no Vercel) ·
  [0006](../adr/0006-auth-do-dashboard.md) (auth do dashboard) ·
  [0002](../adr/0002-persistencia-supabase.md) (persistência/RLS) ·
  [0009](../adr/0009-fila-agent-jobs.md) (fila `agent_jobs`)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 (Onda 6) ·
  §10 · §11

> Escopo desta onda: **apenas** o dashboard read-only autenticado + a base da superfície HTTP.
> O assistente de voz **Nexus** (chat/tools/voz) é a **Onda 7** (SPEC-016) — aqui só preparamos a
> app HTTP (catch-all Hono) e a cadeia de middleware que o Nexus vai reusar.

## Objetivo

Dar ao operador humano uma interface web, atrás de autenticação, para **ver** o estado da operação
direto do banco: clientes, campanhas (hierarquia Meta), análises, funil de conversão e logs de
auditoria/eventos. É o plano "Dashboard" da SPEC-000 §3 — só request/response, leituras
**server-side** via `service_role` (a RLS é deny-by-default; o browser nunca lê o Postgres) e, quando
precisar de ação, **enfileira** em `agent_jobs` (escrita real fica para o runner). Entrega a estrutura
`web/` (Next.js 15 App Router no Vercel), o `middleware.ts` (sessão + CSP por nonce + headers), a auth
por senha→hash + cookie JWT (+ Turnstile opcional + rate limit), as camadas `lib/env.ts` / `lib/db` /
`lib/services/*` / `lib/ratelimit`, as páginas de leitura e a API Hono em
`app/api/[[...route]]/route.ts`.

## Contratos

### Layout de `web/` (entregáveis)

```
web/
├── app/
│   ├── layout.tsx, page.tsx                # overview / clientes
│   ├── login/page.tsx                      # tela de login
│   ├── clients/[slug]/page.tsx             # detalhe do cliente + campanhas
│   ├── campaigns/page.tsx                  # hierarquia Meta
│   ├── analyses/page.tsx                   # análises + findings
│   ├── funnel/page.tsx                     # funil de conversão (7 etapas)
│   ├── logs/page.tsx                       # operation_logs + agent_events
│   └── api/[[...route]]/route.ts           # catch-all Hono (toda a API)
├── middleware.ts                           # sessão + CSP por nonce + headers
├── lib/
│   ├── env.ts                              # validação Zod do env (server/public)
│   ├── db.ts                               # cliente Supabase service_role (server-only)
│   ├── ratelimit.ts                        # Upstash (login + endpoints públicos)
│   ├── auth/{session,password,turnstile}.ts
│   └── services/{clients,campaigns,analyses,funnel,logs}.ts
└── components/ (shadcn/ui)
```

### Invariantes (SPEC-000 §6/§10/§11)

- **Leituras server-side**: nenhum Server Component/handler envia o `SUPABASE_SECRET_KEY` ao browser;
  `lib/db` é `import 'server-only'`. Toda leitura de tabela passa por `lib/services/*`.
- **Dinheiro em centavos**: a UI **nunca** recalcula em float — formata `*_cents` para exibição
  (ex.: `formatCents(spend_cents, currency)`), mantendo o inteiro como fonte.
- **IDs externos da Meta** (`meta_*_id`) são `string`/`text` — exibidos/filtrados como texto.
- **Append-only no read**: `operation_logs`/`agent_events`/`lp_events` são só leitura no dashboard
  (esta onda não escreve neles).
- **Sem PII em log**: logs estruturados do dashboard nunca registram a senha, o cookie/JWT, nem
  conteúdo de `lp_events` além das flags/utm/country/value já NO-PII.
- **`NEXT_PUBLIC_*` nunca é segredo**: só URLs/keys publicáveis (ex.: Turnstile *site key*).

### `lib/env.ts` (esboço Zod — fail-fast no boot)

```ts
// Server-only (segredos): validado uma vez, lançado se faltar.
const ServerEnv = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  DASHBOARD_PASSWORD: z.string().length(64), // hash SHA-256 (hex)
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
});

// Browser-safe: só NEXT_PUBLIC_*.
const PublicEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: z.string().optional(),
});
```

### Auth (ver ADR 0006)

```ts
const LoginBody = z.object({
  password: z.string().min(1).max(512),
  turnstileToken: z.string().optional(),
});
// POST /api/auth/login: rate limit → Turnstile (se configurado) → Zod → compara hash
//   (tempo constante) → set-cookie JWT HttpOnly+Secure+SameSite=Strict (exp curta).
// POST /api/auth/logout: limpa o cookie.
```

### API Hono (`app/api/[[...route]]/route.ts`)

- Monta uma app Hono com `basePath('/api')` e exporta os handlers por método (`GET`/`POST`/...) para
  o Next App Router.
- **Cadeia por rota protegida** (ordem obrigatória, SPEC-000 §11):
  `auth (sessão válida) → authz (operador) → validação (Zod de params/query/body) → lógica (service)`.
- Respostas de leitura retornam JSON puro vindo de `lib/services/*` (sem mutação).
- Endpoints públicos (login) levam rate limit; respostas de erro são genéricas (sem vazar se a
  senha/conta existe).

### `lib/services/*` (somente leitura nesta onda)

Cada serviço recebe o cliente `service_role` de `lib/db` e expõe funções tipadas:
`listClients`, `getClientBySlug`, `listCampaigns(clientId)`, `listAnalyses(clientId)`,
`listFunnelEvents(analysisId)`, `listOperationLogs(clientId)`, `listAgentEvents(runId?)`.
Entradas validadas por Zod antes da query; saídas tipadas (sem `any`).

## Comportamento

### Fluxo de login

1. `GET /login` renderiza o form (com Turnstile se a *site key* pública existir).
2. `POST /api/auth/login`: rate limit por IP (Upstash) → verifica Turnstile (se configurado) →
   `LoginBody.parse` → compara o hash SHA-256 da senha enviada com `DASHBOARD_PASSWORD` em **tempo
   constante** → sucesso: emite cookie JWT (HttpOnly/Secure/SameSite=Strict, exp curta) e redireciona
   para `/`; falha: `401` genérico.
3. Toda rota protegida exige cookie de sessão válido (verificado no `middleware.ts`).

### Fluxo de leitura (páginas)

1. `middleware.ts` valida a sessão → sem sessão: redirect `/login` (página) ou `401` (API).
2. O Server Component chama `lib/services/*` → `lib/db` (`service_role`) → Supabase REST.
3. Renderiza no servidor; o browser recebe HTML/JSON, **nunca** a chave secreta nem acesso direto à
   tabela.

### Idempotência & concorrência

- Leituras são **idempotentes** por natureza (sem efeito colateral).
- Login é idempotente quanto a estado (apenas emite/atualiza cookie); o rate limit é a proteção
  contra repetição abusiva.
- Sessão **stateless** (JWT assinado): não há store; escala horizontalmente no serverless do Vercel
  sem coordenação. Rate limit/idempotência que precisem de estado usam Upstash (não memória de
  processo, que não persiste entre invocações).

### Casos de erro

- **Env inválido/ausente** → `lib/env.ts` lança no boot (fail-fast); deploy não sobe meia-boca.
- **Sessão expirada/assinatura inválida** → `401`/redirect; nunca expõe stack/segredo.
- **Validação Zod falha** → `400` com mensagem genérica (sem ecoar payload sensível).
- **Rate limit estourado** → `429`.
- **Falha de leitura no banco** → log estruturado sem PII + `500` genérico; UI mostra estado de erro.

## Segurança

> Superfície externa **nova** (primeira superfície HTTP com usuário humano) → threat model STRIDE
> obrigatório em [`docs/security/threats/web-dashboard.md`](../security/threats/web-dashboard.md)
> (SPEC-000 §11; criar/atualizar na execução da onda).

- **Ordem `auth → authz → validação → lógica`** em toda rota protegida (sem exceção).
- **Headers em TODAS as respostas** (via `middleware.ts`): **HSTS**, **CSP por nonce** (sem
  `unsafe-inline`; o nonce é gerado por requisição e propagado aos scripts), **X-Content-Type-Options:
  nosniff**, **X-Frame-Options: DENY**, **Referrer-Policy: no-referrer**.
- **RLS fechada ao browser**: leituras só server-side com `service_role`; `lib/db` é `server-only`.
- **Segredos fora do código**: `SUPABASE_SECRET_KEY`, `AUTH_SECRET`, `DASHBOARD_PASSWORD` (hash),
  tokens Upstash/Turnstile vêm do env do Vercel / `.env.local`. `NEXT_PUBLIC_*` nunca carrega segredo.
- **Cookie de sessão**: JWT assinado (`AUTH_SECRET`), **HttpOnly + Secure + SameSite=Strict**,
  expiração curta.
- **Rate limit (Upstash)** no login (por IP) e em endpoints públicos; comparação de senha em **tempo
  constante**; **Turnstile** opcional anti-bot.
- **Validação por schema (Zod)** em toda fronteira (body/params/query); entrada externa é **dado, não
  instrução**.
- **Least privilege**: o dashboard só **lê** o banco e **enfileira** jobs; nunca muta entidades
  Meta/landing diretamente.
- **Sem PII em logs**: nunca logar senha, cookie/JWT, headers de auth.

### STRIDE (resumo das ameaças desta superfície)

- **Spoofing**: forjar sessão sem o segredo → mitigado por JWT assinado + verificação no middleware.
- **Tampering**: alterar cookie/JWT → assinatura inválida rejeitada; SameSite=Strict contra CSRF.
- **Repudiation**: ações sem rastro → leitura não muta; ações reais via `agent_jobs` ficam em
  `operation_logs`/`agent_events` (escritos pelo runner).
- **Information disclosure**: vazar `service_role`/dados via browser → `server-only` + RLS
  deny-by-default + CSP; erros genéricos.
- **Denial of service**: brute force/flood no login → rate limit Upstash + Turnstile.
- **Elevation of privilege**: ler/escrever tabela direto do browser → impossível (sem policies para
  anon/authenticated; só `service_role` server-side).

## Critérios de aceite (gate da Onda 6)

Reproduz/fecha o gate da Onda 6 em [`WAVES.md`](../../WAVES.md):

1. **Login funciona**: credencial correta autentica e emite o cookie de sessão; credencial errada é
   recusada (`401` genérico).
2. **Rotas protegidas exigem sessão**: acesso sem cookie válido redireciona para `/login` (páginas) ou
   responde `401` (API).
3. **`npm run build` + `npm run typecheck` + `npm run lint` verdes** (em `web/`; SPEC-000 §12).
4. **Renderiza dados do seed**: o dashboard mostra dados reais do banco (cliente `cliente-exemplo` e
   o que houver), com leituras **server-side** via `service_role`.
5. **Headers de segurança presentes em todas as respostas**: HSTS, CSP por nonce,
   X-Content-Type-Options, X-Frame-Options, Referrer-Policy.
6. **RLS fechada ao browser**: nenhuma leitura de tabela parte do cliente; `lib/db` é `server-only`.
7. **Rate limit no login** ativo (Upstash).

## Testes

Pirâmide da `.claude/rules/testing.md` (Vitest):

- **Unit (`domain`/`application`/libs puras):**
  - `lib/auth/password`: hash + comparação em tempo constante (sucesso/falha).
  - `lib/auth/session`: emitir/verificar JWT (válido, expirado, assinatura adulterada).
  - `lib/env.ts`: parse Zod aceita env válido e lança em env incompleto/segredo no `NEXT_PUBLIC_*`.
  - Formatação de dinheiro (`*_cents` → string) sem perda/float.
  - Schemas Zod de entrada (`LoginBody`, params dos serviços): aceita válido, rejeita inválido.
- **Integração (I/O):**
  - `lib/services/*` contra Supabase de teste: leitura como `service_role` retorna o seed; o browser
    (anon) **não** lê (RLS).
  - Pipeline da API Hono: rota protegida sem sessão → `401`; com sessão → JSON; login com rate limit
    estourado → `429`.
- **e2e (seletivo, fluxo crítico):**
  - Login → acessar rota protegida → ver dados do seed; logout → rota volta a exigir sessão.
  - Asserção de headers de segurança (CSP nonce, HSTS, etc.) numa resposta protegida.
