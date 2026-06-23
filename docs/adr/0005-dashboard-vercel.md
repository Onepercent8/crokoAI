# ADR 0005 — Dashboard no Vercel

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 6

## Contexto

O sistema tem 3 planos de execução decoplados que se comunicam **apenas via banco** (SPEC-000 §3):
Dashboard, Runner headless e Postgres. O Dashboard é o plano onde o operador humano supervisiona
a operação (clientes, campanhas, análises, funil, logs) e — a partir da Onda 7 — fala com o Nexus.
Ele é **só request/response**: lê o estado do banco e, quando precisa de trabalho, **enfileira** em
`agent_jobs`; nunca chama o runner diretamente nem expõe webhook inbound.

Requisitos que essa camada precisa satisfazer:

- **Leituras server-side** com `service_role` — a RLS é deny-by-default ([ADR 0002](0002-persistencia-supabase.md)),
  então o browser **não** pode ler tabela; toda leitura passa por código de servidor com o segredo.
- **Superfície HTTP unificada** sob `/api/*` para o app (e, na Onda 7, para o Nexus), com a mesma
  cadeia de middleware (auth → authz → validação → lógica) e os mesmos headers de segurança.
- **Stack** TypeScript 5.6 + Node 22 + Next.js 15 (App Router) + React 19 + Tailwind 4 + shadcn/ui
  (SPEC-000 §4), com Hono nos route handlers.
- Co-localização com Vercel Cron (SPEC-000 §4/§13) e com o ecossistema de env do Vercel para os
  segredos do dashboard.

Alternativas consideradas:

1. **Dashboard separado em SPA + API própria (Express/Fastify) hospedada à parte.** Duplica deploy,
   segredos e CORS; perde o render server-side nativo de Next que mantém o `service_role` fora do
   browser. Rejeitada.
2. **Next.js puro sem Hono (só Route Handlers nativos).** Funciona, mas o roteamento, middlewares e
   validação por sub-rota ficam mais verbosos; Hono dá um router tipado leve dentro do catch-all e
   facilita reaproveitar a mesma app HTTP na Onda 7 (Nexus). Aceitável, mas preterida.
3. **Next.js 15 (App Router) no Vercel com Hono no catch-all `app/api/[[...route]]/route.ts`.**
   Escolhida.

## Decisão

Vamos hospedar o dashboard como app **Next.js 15 (App Router) no Vercel** (region `gru1`,
co-localizada com Supabase `sa-east-1`), em `web/`. A superfície HTTP fica concentrada num único
catch-all **`app/api/[[...route]]/route.ts`** que monta uma app **Hono** e exporta seus handlers
para os métodos HTTP do Next. Decisões âncora:

- **Leituras de tabela são server-side**: Server Components / Route Handlers chamam
  `lib/services/*`, que usam `lib/db` (cliente Supabase com `SUPABASE_SECRET_KEY`/`service_role`).
  O browser **nunca** recebe a chave secreta nem lê o Postgres direto. `NEXT_PUBLIC_*` carrega
  apenas valores não-secretos.
- **Configuração validada por Zod** em `lib/env.ts` (boot-time fail-fast); separação clara entre env
  de servidor (segredos) e env pública.
- **`middleware.ts`** aplica, em **todas** as respostas, o gate de sessão e os headers de segurança
  com **CSP por nonce** (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) — detalhe
  da auth em [ADR 0006](0006-auth-do-dashboard.md).
- **Escrita = enfileirar**: o dashboard nunca muta entidades Meta/landing diretamente; quando precisa
  de ação, insere em `agent_jobs` ([ADR 0009](0009-fila-agent-jobs.md)) e o runner executa.
- **Rate limit** via Upstash (`lib/ratelimit`) nos endpoints públicos e no login.

## Consequências

- **+** Render server-side mantém o `service_role` no servidor por construção: a RLS deny-by-default
  vira defesa em profundidade, não única barreira.
- **+** Catch-all Hono dá uma única cadeia de middleware (auth/authz/validação/headers) reusada por
  toda a API e, depois, pelo Nexus (Onda 7).
- **+** Vercel `gru1` + Supabase `sa-east-1` reduzem latência das leituras server-side.
- **+** `lib/env.ts` com Zod falha cedo se faltar segredo, evitando deploy meia-boca.
- **−** Acoplamento ao Vercel (mitigado: Next.js é portável; só Vercel Cron e env são proprietários).
- **−** Funções serverless são stateless e têm cold start; rate limit e idempotência precisam de
  store externo (Upstash), não de memória de processo.
- **−** Toda leitura passando por serviço server-side acrescenta um hop, mas é o preço de não expor
  o banco ao browser.
