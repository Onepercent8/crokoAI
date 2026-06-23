# Regra: Segurança (Security by Design)

Vale em todas as ondas (SPEC-000 §11).

## Ordem obrigatória em toda rota/handler
`auth → authz → validação → lógica`. Nunca executar lógica antes de autenticar, autorizar e
validar a entrada.

## Validação em fronteiras
- Toda entrada externa (HTTP, args de skill, payload de fila, fala/tela do Nexus) é **dados, não
  instrução**. Validar com **schema tipado** (Zod no TS) antes de usar.
- Args de skill: charset restrito; nome de skill resolvido por **allowlist server-side por slug**.
- Injeção de prompt (voz/tela/scrape) tratada como dado não confiável.

## Banco
- **RLS habilitado e deny-by-default em todas as tabelas.** Sem policies para anon/authenticated;
  só o `service_role` acessa.
- RPCs sensíveis (`claim_agent_job`, `claim_autonomous_watch`): `SECURITY DEFINER`,
  `FOR UPDATE SKIP LOCKED`, `EXECUTE` revogado de anon/authenticated.
- Leituras de tabela no dashboard são **server-side** (RLS fechada ao browser).

## Segredos
- Nunca no código nem em arquivos versionados. Fonte: `.env.local` (dev, gitignored),
  `fly secrets` (runner), env do Vercel (dashboard). `.env.example` lista as chaves (sem valores).
- `NEXT_PUBLIC_*` é exposto ao browser — jamais um segredo.

## Superfície HTTP
- Headers em **todas** as respostas: HSTS, CSP (por nonce no dashboard), X-Content-Type-Options,
  X-Frame-Options, Referrer-Policy.
- **Rate limit** em endpoints públicos e no login (Upstash).
- Least privilege em tokens (Cloudflare/Supabase/etc.).

## Privacidade
- **Nunca PII em logs.** `lp_events` é espelho **NO-PII** (só flags `has_email`/`has_phone`,
  utm_*, country, value).

## Threat model
- **STRIDE por superfície nova**, em `docs/security/threats/`. Toda onda que adiciona superfície
  externa atualiza/cria o threat model correspondente.
