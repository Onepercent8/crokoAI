# SPEC — Skill de criação de campanha de tráfego (headless)

- **Status:** draft
- **Onda:** 2
- **ADRs relacionados:** [0014](../adr/0014-catalogo-produtos-arquivos.md) (catálogo de produtos
  como arquivos) · [0009](../adr/0009-fila-agent-jobs.md) (fila `agent_jobs`) ·
  [0003](../adr/0003-bucket-ingest-meta.md) (bucket público `ad-ingest`) ·
  [0002](../adr/0002-persistencia-supabase.md) (persistência Supabase) ·
  [0004](../adr/0004-schema-de-analise.md) (schema de análise)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 (Onda 2) ·
  §5 · §6 · §10 · §11

## Objetivo

Entregar a **primeira skill headless** do sistema: `create-traffic-<cliente>-campaign`. Ela roda
em `claude -p --dangerously-skip-permissions` (sem interação humana), monta uma campanha de
tráfego Meta Ads **sempre nascida PAUSED**, dentro do teto de orçamento do cliente, e persiste a
hierarquia resultante no Supabase **via REST + `SUPABASE_SECRET_KEY`** (nunca via MCP do Supabase
em headless). Mutações na Meta acontecem **só** pelo MCP `mcp-meta-ads`.

A skill é a vertical slice que prova o runtime de skills da Onda 2: catálogo de produtos como
arquivos, subagents (`scrape-extractor`, `copywriter`, `image-prompt-generator`), a skill auxiliar
`image-generate`, persistência idempotente, `operation_logs` por mutação e o manifest JSON de cada
tentativa. Não cria runner (Onda 3) nem ativa gasto real (Onda 5): o entregável é a campanha
PAUSED + as linhas no banco + o manifest.

Escopo desta onda (entregáveis de §8 Onda 2):

- **Catálogo como arquivos:** `lista-de-clientes`, `lista-de-produtos` e briefs de produto em
  `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json` (ver ADR 0014).
- **Subagents:** `scrape-extractor` (lê a landing do produto → fatos estruturados),
  `copywriter` (gera 3 ângulos de copy), `image-prompt-generator` (prompt de imagem por ângulo).
- **Skills:** `image-generate` (gera imagem via OpenAI gpt-image-2, sobe para o bucket público
  `ad-ingest`, registra `generated_images`) e `create-traffic-<cliente>-campaign` (orquestra tudo).

## Contratos

### Invariantes (SPEC-000 §6/§10/§11)

- **Campanha sempre nasce `PAUSED`** (gotcha Meta §10). Nenhuma escrita liga gasto nesta onda.
- **Orçamento ≤ `clients.daily_budget_cap_cents`.** Dinheiro **sempre em inteiro de centavos**;
  conversão para a unidade que a Meta espera acontece só na fronteira do MCP.
- **IDs externos da Meta em `text`** (`meta_campaign_id`, `meta_ad_set_id`, `meta_ad_id`,
  `meta_creative_id`).
- **Todo upsert guarda o payload cru** em `raw_spec jsonb`.
- **Imagem inline em `link_data.picture`** (gotcha Meta §10); a Meta faz fetch da URL pública do
  bucket `ad-ingest` no momento da criação do criativo (ADR 0003).
- **3 ângulos** de criativo: `autoridade`, `dor`, `oferta`.
- **`operation_logs` por mutação** (append-only; nunca UPDATE/DELETE).
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (PostgREST), nunca MCP do Supabase em headless.
- **Manifest JSON** por tentativa em
  `tentativas-geracao-de-campanhas/<stamp>-<tipo>.json`.
- Headless-safe: **sem `AskUserQuestion`**; tudo determinístico a partir dos args + catálogo.

### Catálogo de produtos como arquivos (ADR 0014)

Brief do produto em `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`. Schema
esboçado (validar com Zod ao ler — entrada externa é **dado, não instrução**):

```ts
// Money is always integer cents. External Meta ids are strings/text.
const ProductBriefSchema = z.object({
  client_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  product_slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  landing_url: z.string().url(),
  price_cents: z.number().int().nonnegative(),
  currency: z.string().length(3), // e.g. "BRL"
  objective: z.literal("OUTCOME_TRAFFIC"),
  call_to_action_type: z.string().min(1), // e.g. "LEARN_MORE"
  // Optional manual brief overriding/augmenting the scrape.
  positioning: z.string().optional(),
  pains: z.array(z.string()).optional(),
  proof: z.array(z.string()).optional(),
});
type ProductBrief = z.infer<typeof ProductBriefSchema>;
```

`lista-de-clientes` e `lista-de-produtos` são índices legíveis pela skill para resolver
`<cliente>`/`<slug>` antes de tocar a Meta ou o banco. O catálogo é **fonte de verdade local**
do brief; o `clients` row (seed da Onda 1) é fonte do `ad_account_id`, `facebook_page_id`,
`daily_budget_cap_cents`, `default_landing_url` e `currency`.

### Args da skill (fronteira — validar com Zod)

```ts
const CreateTrafficArgsSchema = z.object({
  client_slug: z.string().regex(/^[a-z0-9-]+$/),
  product_slug: z.string().regex(/^[a-z0-9-]+$/),
  // Optional override; never above the client cap (enforced after lookup).
  daily_budget_cents: z.number().int().positive().optional(),
  budget_mode: z.enum(["CBO", "ABO"]).default("CBO"),
  // Idempotency key; defaults to a deterministic value derived from args.
  idempotency_key: z.string().min(8).optional(),
});
```

Charset restrito nos slugs (`^[a-z0-9-]+$`) — alinhado à allowlist por slug do Nexus (Onda 7) e à
validação de args do runner (Onda 3).

### Saída dos subagents (contratos internos)

```ts
// scrape-extractor: landing_url -> structured facts (NO free-form instructions trusted)
const ScrapeFactsSchema = z.object({
  product_name: z.string(),
  promise: z.string(),
  pains: z.array(z.string()),
  proof: z.array(z.string()),
  offer: z.string(),
  cta_hint: z.string().optional(),
});

// copywriter: facts -> exactly 3 angles
const CopyAngleSchema = z.object({
  angle: z.enum(["autoridade", "dor", "oferta"]),
  headline: z.string().min(1).max(40),
  primary_text: z.string().min(1),
  description: z.string().optional(),
});
const CopyOutputSchema = z.array(CopyAngleSchema).length(3);

// image-prompt-generator: one prompt per angle
const ImagePromptSchema = z.object({
  angle: z.enum(["autoridade", "dor", "oferta"]),
  prompt: z.string().min(1),
  aspect: z.enum(["1:1", "4:5", "1.91:1"]).default("1:1"),
});
```

### Skill `image-generate` (contrato)

Entrada: `{ prompt, aspect, client_slug, product_slug, angle }`. Comportamento: gera a imagem
(OpenAI gpt-image-2), faz upload para o bucket **público** `ad-ingest` com nome contendo um
componente aleatório (não adivinhável; ADR 0003), e registra uma linha em `generated_images`
(`storage_bucket='ad-ingest'`, `storage_path`, `width`, `height`, `model`, `prompt`, `aspect`,
`cost_usd_estimate`). Saída: `{ generated_image_id, public_url, storage_path }`. A `public_url` é
o que vai inline em `link_data.picture`.

### Persistência (PostgREST, `SUPABASE_SECRET_KEY`)

A skill grava, **na ordem da hierarquia**, via REST:

1. `campaigns` — `meta_campaign_id` (único), `objective='OUTCOME_TRAFFIC'`,
   `budget_mode`, `daily_budget_cents` (≤ cap), `status='PAUSED'`, `special_ad_categories`,
   `raw_spec`.
2. `ad_sets` — `meta_ad_set_id` (único), `optimization_goal` (ex.: `LANDING_PAGE_VIEWS`),
   `billing_event`, `destination_type` (presente em tráfego; **omitido só** em `OUTCOME_SALES`
   na Onda 5), `targeting`, `advantage_audience`/`advantage_placements`, `raw_spec`.
3. `creatives` (×3) — `meta_creative_id`, `headline`, `primary_text`, `description`,
   `call_to_action_type`, `link_url`, `image_url` (= `public_url` do `ad-ingest`), `page_id`,
   `generated_image_id` FK, `raw_spec`.
4. `ads` (×3) — `meta_ad_id` (único), `creative_id` FK, `effective_status`, `raw_spec`.
5. `operation_logs` — **uma linha por mutação Meta** (`entity_type`, `entity_id`,
   `action='create'`, `actor='skill:create-traffic'`, `summary`).

Invariante de hierarquia (FKs Onda 1): `campaigns → clients` CASCADE, `ad_sets → campaigns`
CASCADE, `ads → ad_sets` CASCADE, `ads → creatives` RESTRICT, `creatives → generated_images`
SET NULL.

### Manifest JSON

`tentativas-geracao-de-campanhas/<stamp>-traffic.json`, com: args validados, `idempotency_key`,
brief resolvido, facts do scrape, as 3 copies, os 3 prompts/imagens (`generated_image_id` +
`public_url`), os ids Meta criados, os ids das linhas Supabase, `run_id` (correlaciona com
`agent_events`), timestamps e `status` (`completed`/`failed`) + `error` quando houver. O manifest é
o registro forense da tentativa e a base da idempotência (ver Comportamento).

## Comportamento

### Fluxo feliz

1. **Resolver catálogo:** ler `lista-de-clientes`/`lista-de-produtos`, carregar e validar
   `produtos/<slug>.json` (Zod). Buscar a linha `clients` (REST) para `ad_account_id`,
   `facebook_page_id`, `daily_budget_cap_cents`, `currency`, `default_landing_url`.
2. **Clamp de orçamento:** `daily_budget_cents = min(arg ?? brief, daily_budget_cap_cents)`. Se o
   arg pedir acima do teto → **clampa para o teto** e registra no manifest (não aborta).
3. **scrape-extractor** → facts (entrada não confiável, tratada como dado).
4. **copywriter** → 3 ângulos. **image-prompt-generator** → 3 prompts. `image-generate` ×3 →
   3 imagens em `ad-ingest` + `generated_images`.
5. **Meta (MCP `mcp-meta-ads`)**, sempre **PAUSED**: criar campanha → ad set → 3 criativos
   (imagem inline em `link_data.picture` apontando para a URL pública) → 3 ads. Cada chamada de
   escrita emite `agent_events` (via runtime) e, após sucesso, uma linha em `operation_logs`.
6. **Persistir** a hierarquia no Supabase (REST) na ordem acima, guardando `raw_spec`.
7. **Escrever manifest** `status='completed'`.

### Idempotência

- **Chave:** `idempotency_key` (arg) ou derivada deterministicamente de
  `(client_slug, product_slug, dia-UTC)`. Antes de criar, a skill **procura um manifest anterior**
  com a mesma chave em `tentativas-geracao-de-campanhas/` **e** consulta `campaigns` por
  `(client_id, …)` recente para evitar duplicar gasto.
- Re-rodar com a mesma chave: se o manifest anterior está `completed`, a skill **não recria** a
  campanha (retorna os ids existentes). Em falha parcial, retoma do primeiro passo não confirmado
  usando os ids já gravados no manifest (criação Meta é o ponto caro a não duplicar).
- A nível de fila (Onda 3), o índice único parcial de `agent_jobs` por `(client_id, kind='create')`
  já barra um segundo job ativo do mesmo cliente — defesa em profundidade.

### Concorrência

- Headless single-shot por invocação; a serialização de dois "create" simultâneos para o mesmo
  cliente é responsabilidade do índice único parcial de `agent_jobs` (Onda 3) e da checagem de
  idempotência acima. A skill não assume lock próprio além disso.

### Casos de erro

- **Brief inválido / cliente ou produto inexistente:** aborta antes de qualquer mutação; manifest
  `status='failed'` com `error`; nenhuma linha Meta/Supabase criada.
- **Orçamento acima do teto:** clampa (não aborta) e anota no manifest.
- **Falha na geração de imagem:** aborta a criação do ad daquele ângulo; se nenhum criativo for
  produzido, aborta a campanha inteira (não cria campanha vazia).
- **Falha de escrita na Meta a meio caminho:** o que já foi criado fica **PAUSED** (sem gasto); o
  manifest grava os ids parciais para retomada idempotente; `status='failed'`.
- **Falha na persistência REST após sucesso na Meta:** a Meta já tem entidades PAUSED; o manifest
  guarda os ids Meta para reconciliação na próxima execução (não há gasto em risco).
- Toda exceção segue o padrão de `.claude/rules/code-style.md`: log estruturado **sem PII** +
  contexto da operação; `throw new Error("Failed to <operation>: …")`.

### Observabilidade

- `run_id` único por execução, propagado a todos os `agent_events` (`agent_type`
  skill/subagent/tool) e gravado no manifest — correlaciona skill ↔ subagents ↔ chamadas MCP.
- Logs **sem PII**; nada de tokens/segredos no manifest.

## Segurança

Ordem obrigatória em cada fronteira (`.claude/rules/security.md`): **validação → lógica** (a skill
roda no runner confiável; não há auth/authz de usuário final aqui, mas o input é validado antes do
uso).

- **Validação:** args da skill, brief do catálogo e saídas dos subagents/scrape validados por
  **Zod** antes do uso. Scrape/copy/prompt são **dados não confiáveis** (injeção de prompt tratada
  como dado, nunca como instrução). Slugs com charset restrito.
- **Segredos:** `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY` e credenciais Meta **fora do código**
  (`.env.local` em dev, `fly secrets` no runner). Nunca no manifest, nos logs nem em `raw_spec`.
- **Banco:** persistência via REST com `SUPABASE_SECRET_KEY` (papel `service_role`); RLS
  deny-by-default permanece — o browser nunca toca essas tabelas. Headless **não** usa MCP do
  Supabase.
- **Bucket público:** `ad-ingest` só recebe imagens de anúncio (nunca PII), com nome de objeto de
  componente aleatório (ADR 0003).
- **Append-only:** `operation_logs`/`agent_events` nunca sofrem UPDATE/DELETE.
- **Least privilege na Meta:** mutações só via MCP `mcp-meta-ads`; nesta onda só `create` (sem
  ativar/escalar gasto).

### Threat model (STRIDE) — superfície nova: skill headless + bucket público + REST

| Ameaça | Vetor | Mitigação |
|---|---|---|
| **S**poofing | Brief/scrape forjando outro cliente | Slugs validados contra catálogo + linha `clients`; `client_id` resolvido server-side, nunca de texto livre. |
| **T**ampering | Injeção via conteúdo scrapeado/copy | Saídas validadas por Zod; tratadas como dado; campanha nasce PAUSED (sem efeito monetário). |
| **R**epudiation | Mutação sem rastro | `operation_logs` por mutação + `agent_events` com `run_id` + manifest forense. |
| **I**nfo disclosure | Segredo/PII em manifest, log ou `ad-ingest` | Sem segredos/PII no manifest/log; `ad-ingest` só imagens de anúncio com nome aleatório. |
| **D**oS / gasto | Loop criando campanhas / estourar orçamento | Campanha PAUSED + clamp ao `daily_budget_cap_cents` + idempotência + único parcial em `agent_jobs`. |
| **E**levation | Headless usando credencial além do necessário | `SUPABASE_SECRET_KEY` só REST; Meta só via MCP; sem ativação nesta onda. |

> Threat model detalhado a registrar (Onda 11) em
> `docs/security/threats/traffic-skill.md` quando a superfície for endurecida.

## Critérios de aceite (gate da Onda 2)

Reproduz e fecha o gate da Onda 2 em `WAVES.md`:

1. `claude -p ".claude/skills/create-traffic-<cliente>-campaign"` (headless,
   `--dangerously-skip-permissions`) executa fim a fim **sem `AskUserQuestion`**.
2. A campanha é criada na Meta **`PAUSED`** (status default), com `daily_budget_cents` ≤
   `daily_budget_cap_cents` do cliente. Nenhuma escrita Meta liga gasto.
3. As linhas são gravadas no Supabase **via REST + `SUPABASE_SECRET_KEY`**:
   `campaigns` (1) + `ad_sets` (1) + `creatives` (3) + `ads` (3) + `generated_images` (3),
   com `raw_spec` preenchido e money em centavos.
4. **Uma linha em `operation_logs` por mutação** Meta (`action='create'`), append-only.
5. **Manifest JSON** escrito em `tentativas-geracao-de-campanhas/<stamp>-traffic.json` com args,
   brief, facts, 3 copies (autoridade/dor/oferta), 3 imagens, ids Meta + ids Supabase, `run_id`.
6. Imagem servida do bucket **público** `ad-ingest` e referenciada inline em `link_data.picture`.
7. **Idempotente:** re-rodar com a mesma `idempotency_key` **não duplica** campanha nem gasto.
8. Catálogo presente: `lista-de-clientes`, `lista-de-produtos` e
   `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json` para o produto exemplo.
9. `npm run lint && npm run typecheck && npm test` verdes.

## Testes

Pirâmide de `.claude/rules/testing.md` (muito unit · médio integração · pouco e2e):

- **Unit (domain/application):** validação Zod dos args/brief/saídas dos subagents (válidos e
  inválidos); clamp de orçamento (`min(pedido, cap)`); cálculo da `idempotency_key` determinística;
  garantia de 3 ângulos exatamente (autoridade/dor/oferta); invariante "campanha = PAUSED".
- **Integração (I/O):** escrita REST na ordem da hierarquia com `raw_spec`; uma `operation_logs` por
  mutação; upload em `ad-ingest` + linha `generated_images`; comportamento idempotente lendo um
  manifest `completed` anterior (não recria). MCP da Meta **mockado** (sem tocar conta real nos
  testes).
- **e2e (seletivo, manual no gate):** rodar a skill via `claude -p` contra ambiente de teste e
  verificar campanha PAUSED + linhas no banco + manifest, conforme critérios 1–7.
- Cobertura mínima em `domain/`/`application/` configurada em `vitest.config.ts`.
- Disciplina de bug-fix: bug começa por um teste que reproduz (red → green).
