# SPEC-011 — Geração e publicação de landing pages

- **Status:** draft
- **Onda:** 8
- **ADRs relacionados:** [0012](../adr/0012-landing-cloudflare-pages.md) (Cloudflare Pages) ·
  [0013](../adr/0013-design-system-da-lp.md) (design system / 17 seções) ·
  [0014](../adr/0014-catalogo-produtos-arquivos.md) (catálogo de produtos como arquivos) ·
  [0015](../adr/0015-lp-editavel-no-supabase.md) (conteúdo no Supabase) ·
  [0016](../adr/0016-tabela-products.md) (tabela `products`) ·
  [0017](../adr/0017-pacote-lp-render.md) (pacote `@template/lp-render`)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 (Onda 8) ·
  §6 (landing pages) · §10 (contratos de skill/landing) · §11 (transversais)
- **Depende de:** Onda 1 (schema `products`/`landing_pages`/`landing_page_sections`/`agent_jobs`) ·
  Onda 3 (runner Fly: fila + `claim_agent_job`). **Precede:** Onda 9 (editor + modo autônomo) e
  Onda 10 (tracking).

## Objetivo

Gerar e publicar landing pages de alta conversão para os produtos de um cliente, 100% operadas por
IA. A feature entrega:

- **`packages/lp-render` (`@template/lp-render`)** — fonte única dos tipos `ContentDoc`/`Theme`/
  `Settings`, do catálogo das **17 seções** (cada uma com schema Zod), do **serializer**
  `ContentDoc → messages/pt.json + content-spec.json + theme.css`, e das **libs de domínio de
  apresentação** `checkout`/`affiliate`/`utm`/`consent` (puras, testáveis).
- **`landing-pages/_template`** — app Next.js 15 em **static export** que renderiza as 17 seções a
  partir dos artefatos serializados; clonado por LP no publish.
- **Subagents** `landing-page-architect` (escolhe e ordena seções a partir do brief do produto) e
  `lp-copywriter` (preenche os `fields` de cada seção com copy de conversão).
- **Skill `create-landing-page-<cliente>`** — monta a `ContentDoc` (rascunho), persiste no Supabase
  (`landing_pages` + `landing_page_sections`) com `noindex=true`, e **enfileira** um job
  `landing_publish`.
- **Skill `publish-landing-page-<cliente>`** — lê o rascunho do banco, serializa via
  `@template/lp-render`, builda o `_template` (`next build`) e faz deploy no **Cloudflare Pages**
  em `<subdomain>.example.com` (preview, `noindex`).

Conteúdo vive **no Supabase**, não em arquivos (ADR 0015). Os artefatos serializados são efêmeros de
build. Go-live indexável é passo manual posterior (fora desta onda).

## Contratos

### Invariantes (SPEC-000 §6/§10/§11)

- **Dinheiro** em **inteiro de centavos** (`price_cents:bigint`); nunca float; a serialização para
  exibição formata a partir dos centavos.
- **Conteúdo no banco, não em arquivo:** `ContentDoc` ↔ `landing_pages.settings/theme` +
  `landing_page_sections.fields`. Os arquivos `messages/pt.json`/`content-spec.json`/`theme.css` são
  **derivados** (efêmeros de build).
- **Criar nasce `noindex=true`** (preview); `status=draft`, `draft_status` progride
  `empty → generating → ready → editing → publishing`; `status` progride
  `draft → building → deployed | failed`.
- **Catálogo fechado:** só os **17 tipos** de seção existem; `landing_page_sections.(landing_page_id,
  type)` é único; toda escrita de seção é validada por **Zod** na fronteira (entrada = dado, não
  instrução — §11).
- **Persistência headless** via **REST + `SUPABASE_SECRET_KEY`** (NUNCA o MCP do Supabase — §10);
  RLS deny-by-default (só `service_role`). **Manifest JSON** por execução em
  `tentativas-geracao-de-campanhas/<stamp>-<tipo>.json` e **`operation_logs`** por mutação.
- **Skills headless-safe:** sem `AskUserQuestion`, `--dangerously-skip-permissions`, idempotentes.
- **Placeholders do template preservados:** cliente `cliente-exemplo`, produtos
  `curso-exemplo`/`workshop-exemplo`, agência **Acme**, domínio **example.com**, scope
  **@template**.

### `ContentDoc` (núcleo do `@template/lp-render`)

Esboço dos schemas Zod (tipos derivados via `z.infer`; nomes em inglês):

```ts
// 17 tipos de seção — catálogo fechado (ADR 0013). Nomes ilustrativos.
const SectionType = z.enum([
  "hero", "logo_cloud", "benefits", "features", "how_it_works",
  "social_proof", "testimonials", "stats", "pricing", "offer",
  "guarantee", "faq", "about", "lead_form", "cta",
  "video", "footer",
]); // 17

// Tema: identidade visual → theme.css (custom properties)
const Theme = z.object({
  palette: z.object({
    primary: z.string(), secondary: z.string(),
    background: z.string(), foreground: z.string(), accent: z.string(),
  }),
  typography: z.object({ headingFont: z.string(), bodyFont: z.string() }),
  radius: z.enum(["none", "sm", "md", "lg", "full"]),
  shadow: z.enum(["none", "sm", "md", "lg"]),
});

// Settings da página
const Settings = z.object({
  locale: z.literal("pt"),
  title: z.string().min(1).max(120),
  metaDescription: z.string().max(320).optional(),
  noindex: z.boolean().default(true),       // criar => preview noindex
  checkoutUrl: z.string().url().optional(),
  priceCents: z.number().int().nonnegative().optional(), // centavos
});

// Cada seção valida seus próprios fields por um schema por tipo
const Section = z.object({
  type: SectionType,
  position: z.number().int().nonnegative(),
  enabled: z.boolean().default(true),
  version: z.number().int().positive().default(1),
  fields: z.record(z.unknown()), // refinado por SECTION_FIELD_SCHEMAS[type]
});

const ContentDoc = z.object({
  settings: Settings,
  theme: Theme,
  sections: z.array(Section).min(1),
});
```

- Cada `type` tem um schema concreto de `fields` em `SECTION_FIELD_SCHEMAS[type]`; a validação
  completa é `ContentDoc` + refinamento por seção (rejeita campo desconhecido / tipo fora do
  catálogo). O editor da Onda 9 reusa exatamente esses schemas.

### Serializer (`@template/lp-render`)

`serialize(doc: ContentDoc) → { "messages/pt.json", "content-spec.json", "theme.css" }`:

- `messages/pt.json` — strings i18n (copy por seção).
- `content-spec.json` — estrutura (seções habilitadas, ordem, refs de campo) que o `_template` lê no
  build.
- `theme.css` — custom properties derivadas de `Theme`.
- **Pura** (sem I/O/rede); roda com `tsx` no runner. Determinística: mesma `ContentDoc` ⇒ mesmos
  artefatos (suporta idempotência do publish).

### Libs de domínio (puras)

- `checkout` — monta a URL de checkout a partir de `checkoutUrl` + parâmetros; preserva centavos.
- `affiliate` — injeta/valida parâmetro de afiliado (charset restrito).
- `utm` — propaga/normaliza `utm_*` para os links (sem inventar valores).
- `consent` — estado de consentimento (base para o tracking da Onda 10; aqui só o contrato).

### Skill `create-landing-page-<cliente>`

- **Entrada (args do job/skill):** `{ client_slug, product_slug, subdomain? }` — validados por Zod;
  `client_slug`/`product_slug`/`subdomain` com **charset restrito** (`^[a-z0-9-]+$`).
- **Fluxo:** resolve `products` (FK do cliente) → `landing-page-architect` escolhe/ordena seções →
  `lp-copywriter` preenche `fields` → valida `ContentDoc` (Zod) → **escreve rascunho** em
  `landing_pages` (`noindex=true`, `status=draft`, `draft_status=ready`) + `landing_page_sections`
  (uma linha por seção) via REST + `SUPABASE_SECRET_KEY` → **enfileira** `agent_jobs`
  `{ kind:'landing_publish', skill:'publish-landing-page-<cliente>', landing_page_id, status:'pending', requested_by:'create-landing-page' }`.
- **Saída:** `landing_page_id`, manifest JSON, `operation_logs` (`action=create`, `entity_type=landing_page`).

### Skill `publish-landing-page-<cliente>`

- **Entrada:** `{ landing_page_id }` (Zod, uuid).
- **Fluxo:** marca `draft_status=publishing`, `status=building` → lê `ContentDoc` do banco →
  `serialize()` → clona `landing-pages/_template`, injeta artefatos → `next build` (static export) →
  `wrangler pages deploy` em `<subdomain>.example.com` (preview, `noindex`) → grava
  `cloudflare_project_id`, `fqdn`/`url`, `ssl_status`, `published_snapshot` (jsonb), `status=deployed`
  → `operation_logs` (`action=update`). Em erro: `status=failed`, `operation_logs`, exit code ≠ 0.
- **Saída:** URL preview acessível (HTTP 200), manifest, `operation_logs`.

### Tabelas tocadas (SPEC-000 §6)

`products` (leitura), `landing_pages` (insert/update), `landing_page_sections` (insert/update),
`agent_jobs` (insert do `landing_publish`; claim pelo runner), `operation_logs` (append-only),
`agent_events` (append-only, via runtime de skill). Storage `landing-assets` (público) para imagens
da LP.

## Comportamento

### Fluxo principal

1. Job `landing` (ou chamada direta da skill) → `create-landing-page-<cliente>` gera o rascunho e
   enfileira `landing_publish`.
2. O runner faz `claim_agent_job` do `landing_publish` (FOR UPDATE SKIP LOCKED, ADR 0009) e roda
   `publish-landing-page-<cliente>`.
3. Publish serializa do banco, builda e faz deploy → preview `<subdomain>.example.com` (200).

### Idempotência

- **Dedup de job:** o índice único parcial de `agent_jobs` garante **≤1 job ativo** por
  `(landing_page_id, kind)` — segunda inserção de `landing_publish` para a mesma LP falha com unique
  violation, tratada pelo produtor como "já enfileirado" (não erro fatal).
- **Re-publish:** reaproveita `cloudflare_project_id` (deploy sobre o mesmo projeto Pages); serializer
  determinístico ⇒ mesmo input ⇒ mesma saída. Re-rodar não cria projeto/subdomínio duplicado.
- **Seção única:** `(landing_page_id, type)` único — recriar uma seção é upsert por chave, não
  duplicação.

### Concorrência

- Claim atômico via `claim_agent_job` (SECURITY DEFINER, SKIP LOCKED): cada job vai a exatamente um
  worker. O índice único parcial impede dois publishes ativos da mesma LP.
- `landing_pages.draft_status`/`status` funcionam como guarda de estado: publish só age sobre LP em
  estado consistente; transição é registrada e os logs/eventos são append-only.

### Casos de erro

- **Brief/produto ausente:** aborta antes de escrever; `operation_logs` com motivo; sem job.
- **`ContentDoc` inválida (Zod):** rejeita na fronteira; nada persistido; manifest registra a falha.
- **`next build` falha:** `status=failed`, `operation_logs`, exit ≠ 0; rascunho preservado para
  re-tentativa (re-enfileirar `landing_publish`).
- **Deploy `wrangler` falha:** `status=failed`; sem URL publicada; idempotente para nova tentativa.
- Tratamento de erro segue o padrão da §11 (log estruturado **sem PII** + contexto da operação).

## Segurança

Ordem obrigatória em toda fronteira: **auth → authz → validação → lógica** (§11). Pontos:

- **Validação por schema tipado (Zod)** em toda entrada: args de skill, `ContentDoc`, `fields` por
  seção. Saída de subagent (architect/copywriter) é **dado não confiável** — validada contra os
  schemas antes de persistir (defesa contra prompt injection vinda do brief/scrape).
- **Nome de skill por allowlist server-side por slug** (`LANDING_SKILL_BY_SLUG`,
  `PUBLISH_SKILL_BY_SLUG`) — nunca texto livre (§10/§11). Args com charset restrito
  (`slug`/`subdomain` `^[a-z0-9-]+$`).
- **RLS deny-by-default**; persistência headless via REST + `SUPABASE_SECRET_KEY` (não MCP).
- **Segredos** (`SUPABASE_SECRET_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) **fora do
  código** — `fly secrets` no runner; least privilege no token Cloudflare (escopo Pages).
- **`noindex=true` no preview** evita indexar página não-aprovada; go-live é manual.
- **Sem PII** em logs/`operation_logs`/`agent_events`/manifest.
- Conteúdo gerado vai para HTML **estático** dentro do catálogo fechado de seções (sem HTML
  arbitrário do modelo) — reduz superfície de XSS; o render escapa por padrão.

### Threat model STRIDE — superfície nova: publish/deploy de LP no Cloudflare Pages

| Categoria | Ameaça | Mitigação |
|---|---|---|
| **S**poofing | Skill falsa/args forjados disparando deploy | Allowlist server-side slug→skill; charset restrito; só o runner (service_role) executa; sem superfície HTTP inbound (§3). |
| **T**ampering | `ContentDoc`/seção adulterada via brief/scrape (prompt injection) | Saída de subagent tratada como dado; validação Zod por seção; catálogo fechado (sem HTML livre). |
| **R**epudiation | Quem/quando publicou não rastreável | `operation_logs` (append-only) por mutação + `agent_events` com `run_id`; `published_snapshot` no banco. |
| **I**nfo. disclosure | Vazamento de token Cloudflare / segredo no artefato | Segredos só em `fly secrets`; nada de segredo nos artefatos serializados; sem PII em logs. |
| **D**oS | Loop de re-deploys / jobs duplicados | Índice único parcial `(landing_page_id, kind)`; claim 1 job/min no runner; build com timeout. |
| **E**levation | Token Cloudflare amplo demais | Least privilege (escopo Pages/DNS mínimo); RLS deny-by-default no banco. |

Threat model detalhado a manter em `docs/security/threats/` quando a superfície for implementada
(o editor da LP tem o seu próprio em `landing-page-editor`, Onda 9; o tracking em Onda 10).

## Critérios de aceite (gate da Onda 8 — WAVES.md §Onda 8)

1. **`create-landing-page-<cliente>` grava rascunho + job `landing_publish`:** executar a skill
   escreve `landing_pages` (`noindex=true`, `status=draft`) + N linhas em `landing_page_sections` e
   insere uma linha `agent_jobs` `kind='landing_publish'` para a LP.
2. **`publish-landing-page-<cliente>` builda e serve 200 em preview:** o publish serializa do banco,
   roda `next build` e faz deploy; a URL `<subdomain>.example.com` responde **HTTP 200**.
3. **`_template` builda verde:** `next build` do `landing-pages/_template` (static export) passa.
4. **Persistência correta:** escrita via REST + `SUPABASE_SECRET_KEY` (não MCP); manifest JSON
   gravado; `operation_logs` por mutação; preço em centavos.
5. **Idempotência/dedup:** 2º `landing_publish` ativo para a mesma LP é barrado pelo índice único
   parcial; re-publish reaproveita `cloudflare_project_id` sem duplicar projeto/subdomínio.
6. **Gate de qualidade verde:** `npm run lint && npm run typecheck && npm test` (inclui unit das
   libs do `@template/lp-render`).

## Testes

Pirâmide (§11 / `.claude/rules/testing.md`):

- **Unit (muito)** — no pacote `@template/lp-render` (domínio puro): schemas Zod das 17 seções
  (válido/ inválido / campo desconhecido); serializer determinístico (mesma `ContentDoc` ⇒ mesmos 3
  artefatos); libs `checkout`/`affiliate`/`utm`/`consent` (URLs, centavos, charset, edge cases).
- **Integração (médio)** — escrita REST + `SUPABASE_SECRET_KEY` em `landing_pages`/
  `landing_page_sections`; enfileiramento de `agent_jobs` e dedup pelo índice único parcial;
  `next build` do `_template` com artefatos de exemplo (página renderiza as seções).
- **e2e (pouco)** — fluxo `create → publish → preview 200` (fluxo crítico "publicar LP" da §11),
  cobrindo o gate da onda.
- **Disciplina:** bug fix começa por teste que reproduz; testar caminhos de erro (ContentDoc
  inválida, build/deploy falho), não só o caminho feliz.
