# ADR 0012 — Landing pages no Cloudflare Pages

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 8

## Contexto

A agência precisa servir landing pages (LPs) de alta conversão por cliente/produto, cada uma num
subdomínio próprio (`<subdomain>.example.com`). As LPs são **estáticas** após a build (não há SSR
por requisição: o conteúdo é serializado do banco no momento de publicar). Requisitos:

- **Custo e escala:** servir HTML/CSS/JS estático com CDN global, sem manter servidor de origem.
- **Decoplamento (SPEC-000 §3):** o build/publish roda no **runner headless** (Fly.io), via skill
  enfileirada (`landing_publish`). Não pode haver chamada inbound entre planos; o deploy é um
  efeito de um job, disparado por CLI no runner.
- **Domínio próprio + SSL:** subdomínios wildcard sob `example.com` com certificado gerenciado.
- **Preview antes do go-live:** publicar primeiro como preview `noindex=true`; tornar indexável é
  passo manual posterior.

Alternativas consideradas: **Vercel** (já hospeda o dashboard, mas misturaria a superfície do
operador com as LPs públicas e o modelo de projeto-por-LP fica caro/limitado); **Supabase Storage
estático** (sem domínio/SSL por projeto nem pipeline de build); **S3 + CloudFront** (mais peças
de IaC, SSL e DNS manuais).

## Decisão

Vamos servir as landing pages no **Cloudflare Pages**, um projeto Pages por LP, deployado pela
skill `publish-landing-page-<cliente>` no runner via **`wrangler`**. O fluxo de publish é:
serializar a `ContentDoc` do banco (ver [ADR 0015](0015-lp-editavel-no-supabase.md)) →
`next build` do `landing-pages/_template` em **static export** → `wrangler pages deploy`. A LP nasce
em **preview com `noindex=true`** sob `<subdomain>.example.com`; o go-live indexável é manual.

O DNS e o SSL wildcard de `example.com` ficam no Cloudflare (mesma conta do Worker de tracking,
ADR 0021). O identificador do projeto Pages é persistido em `landing_pages.cloudflare_project_id`
para reuso em re-publicações (idempotência por LP).

## Consequências

- **+** CDN global e custo baixo para conteúdo estático; sem origem para manter.
- **+** Deploy é um efeito de job no runner (alinha com o decoplamento via fila da SPEC-000 §3).
- **+** SSL/DNS gerenciados; subdomínio por LP isolado do dashboard (superfícies separadas).
- **+** Mesma conta Cloudflare já usada pelo Worker de tracking (ADR 0021) — uma fronteira externa.
- **−** Build estático significa **sem dados dinâmicos por request**: tudo que varia é resolvido no
  publish (serialização do banco). Mudança de conteúdo exige re-publish (novo job).
- **−** Acoplamento ao `wrangler`/Cloudflare como dependência do runner (mitigado: a interface de
  deploy é encapsulada na skill; o artefato é HTML estático portável).
- **−** Credenciais Cloudflare (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) entram no
  `fly secrets` do runner — superfície de segredo a mais (least privilege no token).
