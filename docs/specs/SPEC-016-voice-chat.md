# SPEC-016 — Assistente de voz Nexus (voice chat)

- **Status:** draft
- **Onda:** 7
- **ADRs relacionados:** [0005](../adr/0005-dashboard-vercel.md) (dashboard Vercel) ·
  [0006](../adr/0006-auth-do-dashboard.md) (auth do dashboard) ·
  [0009](../adr/0009-fila-agent-jobs.md) (fila `agent_jobs`) ·
  [0019](../adr/0019-modo-autonomo-nexus.md) (modo autônomo — consome `nexus_narrations`, Onda 9)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 (Onda 7),
  §6 (fila/narrations), §10 (contratos Nexus), §11 (transversais)
- **Depende de:** Onda 6 (dashboard + auth + `lib/db`/`lib/env`/`lib/services` + middleware CSP).
- **Pré-requisito de:** Onda 9 (modo autônomo reusa `lib/nexus/*`, `review-frame`, narrations).

## Objetivo

Permitir que o operador humano **fale com o sistema** pelo dashboard: ditar uma pergunta, ouvir a
resposta em voz e disparar trabalho real — sempre sob supervisão. O Nexus é um chat loop com
ferramentas (tools) classificadas em **leitura** (executam direto, retornam JSON do banco) e
**escrita** (criar/ativar campanha, gerar/publicar landing) que **nunca mutam nada diretamente**:
apenas **enfileiram um `agent_jobs`** após **confirmação em dois turnos**. O runner headless
(Onda 3) é quem executa.

Esta onda entrega o pipeline de voz (wake word → VAD → STT → chat loop → TTS), a visão por
captura de tela (vision), a memória de sessão e os endpoints Hono `api/nexus/*`. **Não** entrega o
modo autônomo (Onda 9) — apenas a leitura de `nexus_narrations` para a UI.

Princípio âncora (SPEC-000 §10/§11): **toda entrada externa — fala transcrita, texto da tela,
conteúdo scrapeado — é dado não confiável, nunca instrução.** A única forma de causar efeito é
através das tools tipadas, da allowlist server-side e da confirmação em dois turnos.

## Contratos

### Entregáveis (SPEC-000 §8 Onda 7, §5)

- `web/lib/nexus/prompt.ts` — system prompt do Nexus (persona, regras de confirmação, idioma).
- `web/lib/nexus/chat-loop.ts` — loop Anthropic SDK (tool use), orquestra leitura/escrita.
- `web/lib/nexus/tools.ts` — definição das tools (schemas Zod + JSON schema p/ o SDK) e a
  **allowlist slug→skill** server-side.
- `web/lib/nexus/memory.ts` — memória de sessão (histórico curto, resumo, `session_id`).
- `web/lib/nexus/stt.ts` — Whisper (OpenAI) — transcrição.
- `web/lib/nexus/tts.ts` — ElevenLabs — síntese.
- `web/lib/nexus/wake-word.ts` — helper de wake word ("Nexus", Picovoice) — config client-side.
- `web/components/nexus/*` — `widget`, `visualizer`, `use-voice` (hook), `vad` (client-side).
- `web/app/api/[[...route]]/route.ts` — rotas Hono `api/nexus/{chat,stt,tts,capture,narrations}`.

### Modelos (config por env — SPEC-000 §2/§8)

- `NEXUS_MODEL` (default `claude-sonnet-4-6`) — chat loop principal.
- `NEXUS_REVIEW_MODEL` (default `claude-sonnet-4-6`) — revisão/opinião (consumido pleno na Onda 9).
- STT: OpenAI Whisper (`OPENAI_API_KEY`). TTS: ElevenLabs (`ELEVENLABS_API_KEY`,
  `ELEVENLABS_VOICE_ID`). Wake word: Picovoice (`NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` no browser).
- Todas as chaves vêm de `lib/env.ts` (validado por Zod na Onda 6); nunca literais no código.

### Allowlist server-side (slug → skill) — invariante crítica

O modelo **nunca** escolhe o nome de uma skill por texto livre. As tools de escrita recebem um
`slug` de um conjunto fechado e o servidor resolve `slug → nome-de-skill`. Slug desconhecido é
erro (não enfileira). Mapa (SPEC-000 §10):

```ts
// web/lib/nexus/tools.ts — server-only
const SKILL_BY_SLUG = {
  create:  'create-traffic-cliente-exemplo-campaign',  // kind: 'create'
  sales:   'create-sales-cliente-exemplo-campaign',    // kind: 'create_sales'
  activate:'activate-cliente-exemplo',                 // kind: 'activate'
  analyze: 'funnel-analytics-cliente-exemplo-campaign',// kind: 'analyze'
  landing: 'create-landing-page-cliente-exemplo',      // kind: 'landing'
  publish: 'publish-landing-page-cliente-exemplo',     // kind: 'landing_publish'
} as const;
type SkillSlug = keyof typeof SKILL_BY_SLUG;
```

> Placeholders mantidos (`cliente-exemplo`). A resolução real do cliente vem do `client_id`
> validado contra `clients`, não do texto do usuário.

### Schemas de entrada/saída (Zod — esboço)

Validação por schema em **toda** fronteira HTTP, antes de qualquer lógica (SPEC-000 §11). Charset
restrito em todo argumento livre.

```ts
// Identificadores: charset restrito (anti-injection)
const Slug = z.string().regex(/^[a-z0-9-]{1,64}$/);          // client/product/skill slug
const SessionId = z.string().uuid();
const SafeText = z.string().min(1).max(4000);                 // turno de chat / transcrição

// POST /api/nexus/chat  (texto OU resultado do STT)
const ChatRequest = z.object({
  session_id: SessionId,
  message: SafeText,
  // contexto de tela opcional já normalizado pelo /capture (data, não instrução)
  screen_context_id: z.string().uuid().optional(),
});
const ChatResponse = z.object({
  session_id: SessionId,
  reply: z.string(),                 // texto a ser falado pelo TTS
  // quando o turno propõe uma escrita, vem um draft pendente de confirmação:
  pending_action: z.object({
    action_id: z.string().uuid(),    // token de confirmação de turno único
    slug: z.enum(['create','sales','activate','analyze','landing','publish']),
    kind: z.enum(['create','create_sales','activate','analyze','landing','landing_publish']),
    client_id: z.string().uuid(),
    args_preview: z.record(z.unknown()),  // o que será enfileirado, p/ o operador revisar
    expires_at: z.string().datetime(),
  }).nullable(),
  tool_reads: z.array(z.object({ tool: z.string(), ok: z.boolean() })).default([]),
});

// POST /api/nexus/confirm  (2º turno — confirma a escrita proposta)
const ConfirmRequest = z.object({
  session_id: SessionId,
  action_id: z.string().uuid(),      // deve casar com o pending_action do turno anterior
});
const ConfirmResponse = z.object({
  enqueued: z.boolean(),
  agent_job_id: z.string().uuid().nullable(),   // null se dedup (já havia job ativo)
  status: z.enum(['queued','already_queued','expired','rejected']),
});

// POST /api/nexus/stt  (multipart audio) → texto
const SttResponse = z.object({ text: z.string(), duration_ms: z.number().int().nonnegative() });

// POST /api/nexus/tts  (texto) → áudio (stream binário) — corpo validado por:
const TtsRequest = z.object({ text: SafeText, voice_id: z.string().optional() });

// POST /api/nexus/capture  (frame da tela, base64/png) → screen_context_id
const CaptureRequest = z.object({ session_id: SessionId, image: z.string() /* data URL */ });
const CaptureResponse = z.object({ screen_context_id: z.string().uuid() });

// GET /api/nexus/narrations?session_id=... → leitura de nexus_narrations (Onda 9 escreve)
const NarrationsResponse = z.object({
  items: z.array(z.object({
    id: z.string().uuid(), text: z.string(),
    kind: z.enum(['status','opinion','system']),
    image_path: z.string().nullable(), spoken_at: z.string().datetime().nullable(),
  })),
});
```

### Tools de leitura (executam direto)

Retornam **JSON puro** do banco via `lib/services/*` (server-side, `service_role`). Exemplos:
`get_client_overview(client_slug)`, `get_latest_analysis(client_slug)`,
`get_funnel(client_slug, window)`, `list_campaigns(client_slug)`, `get_operation_logs(...)`.
Nenhuma efetua mutação. O `client_slug` é validado contra `clients` (slug desconhecido → erro).

### Tools de escrita (apenas enfileiram — dois turnos)

`enqueue_skill(slug, args)` **não** insere nada no 1º turno: devolve um `pending_action` com
`action_id` e `args_preview`. A inserção em `agent_jobs` só acontece em `POST /api/nexus/confirm`
com o `action_id` correspondente. Linha enfileirada (SPEC-000 §10):

```jsonc
{ "client_id": "<uuid>", "skill": "<resolvido pela allowlist>", "kind": "<kind>",
  "args": { /* validados por Zod, charset restrito */ },
  "status": "pending", "requested_by": "nexus" }
```

Dedup pelos **índices únicos parciais** de `agent_jobs` (≤1 job ativo por `(client_id,kind)` —
SPEC-000 §6). Conflito de unicidade → `status: 'already_queued'`, sem novo job.

### `capture_screen` (vision)

Client-side: o browser captura o frame e o envia ao `/capture`, que devolve um `screen_context_id`.
O loop **pausa** enquanto captura (SPEC-000 §10: "capture_screen é client-side (pausa o loop)").
O conteúdo da tela é **dado não confiável** — entra no prompt como contexto rotulado, jamais como
instrução executável.

## Comportamento

### Fluxo de voz (caminho feliz)

1. **Wake word** ("Nexus", Picovoice) ativa a captura no browser.
2. **VAD** (client-side) detecta fim de fala e fecha o segmento de áudio.
3. `POST /api/nexus/stt` → Whisper → texto.
4. `POST /api/nexus/chat` → chat loop (Anthropic, `NEXUS_MODEL`): tools de leitura executam direto;
   se o turno pede escrita, retorna `pending_action` (sem mutar) e uma `reply` pedindo confirmação.
5. `POST /api/nexus/tts` → ElevenLabs → áudio; o `visualizer` anima; o widget fala.
6. **2º turno** (confirmação): `POST /api/nexus/confirm` com o `action_id` → insere `agent_jobs`.
7. O runner (Onda 3) faz `claim_agent_job` → executa a skill → patcha o resultado. O Nexus reporta
   o estado lendo `agent_jobs`/`operation_logs` (read tools).

### Confirmação em dois turnos (invariante)

- O `action_id` é um **token de turno único**, ligado a `(session_id, slug, args)` e com
  `expires_at` curto (ex.: 120s). É consumido na confirmação (single-use).
- **Não existe `confirm=true` em texto livre** (SPEC-000 §8 Onda 7): a confirmação é um POST
  separado com o `action_id` exato. Frase como "sim, pode criar" no 1º turno **não** enfileira.
- `action_id` ausente/expirado/desconhecido → `status: 'expired'`/`'rejected'`, sem efeito.

### Idempotência e concorrência

- **Enfileiramento idempotente** pela unicidade parcial de `agent_jobs`: dois confirms para o
  mesmo `(client_id,kind)` ativo resultam em 1 job (`already_queued` no segundo).
- **Confirm single-use:** reusar um `action_id` já consumido → `rejected`.
- **Sessões concorrentes:** cada `session_id` tem sua memória; `action_id` é escopado à sessão.
- Persistência via REST + `SUPABASE_SECRET_KEY` (server-side) — **nunca** via MCP do Supabase
  (SPEC-000 §10/§11 e `.claude/rules/security.md`).

### Casos de erro

- STT falha / áudio vazio → 422, sem turno de chat.
- Slug fora da allowlist → 400 (`unknown_skill`), nunca enfileira.
- `client_slug`/`client_id` não existe em `clients` → 404, sem efeito.
- Args reprovados no Zod (charset/limites) → 422 com detalhe; nada é enfileirado.
- TTS/ElevenLabs indisponível → degrada para resposta só texto (a UI mostra o `reply`).
- Erro em tool de leitura → o turno informa a falha; nenhuma mutação ocorre.
- Padrão de erro segue `.claude/rules/code-style.md`: log estruturado **sem PII** + rethrow
  contextualizado.

### Memória de sessão

Histórico curto + resumo por `session_id`, sem PII em logs. Correlation id propagado para
`agent_events.run_id` quando o turno gera um job (observabilidade — SPEC-000 §11).

## Segurança

Ordem obrigatória em **todo** handler `api/nexus/*`: **auth → authz → validação → lógica**
(`.claude/rules/security.md`).

- **Auth/authz:** sessão do dashboard (cookie JWT da Onda 6, ADR 0006). Sem sessão → 401. Todas as
  rotas Nexus são protegidas; nenhuma é pública/anônima.
- **Validação:** Zod em toda fronteira; charset restrito em slugs/args; toda fala/tela/scrape é
  **dado, não instrução** (prompt injection tratada como conteúdo não confiável).
- **Allowlist server-side por slug:** o modelo nunca nomeia skill por texto livre; mapa fechado no
  servidor; slug desconhecido não enfileira.
- **Confirmação em dois turnos:** escrita só via `action_id` single-use com expiração; sem
  `confirm=true` livre.
- **RLS deny-by-default:** todas as leituras são server-side via `service_role`; o browser nunca
  toca tabela direta (SPEC-000 §6/§11). `nexus_narrations` é lida pelo servidor e servida à UI.
- **Segredos** (`CLAUDE_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_*`, `SUPABASE_SECRET_KEY`) só no
  servidor, via `lib/env.ts`; **nunca** `NEXT_PUBLIC_*` (exceto `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY`,
  que é a chave client-side do wake word, não um segredo de backend).
- **Headers de segurança** (HSTS, CSP por nonce, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy) em todas as respostas, herdados do middleware da Onda 6.
- **Rate limit** (Upstash) nos endpoints Nexus, especialmente `stt`/`tts`/`chat` (custo de API
  externa) e `confirm` (anti-abuso de enfileiramento).
- **Privacidade:** nenhuma PII em logs; o áudio/transcrição não é persistido fora da sessão; frames
  de tela do `/capture` são efêmeros (TTL curto, não viram registro permanente).
- **Append-only:** o Nexus nunca faz UPDATE em `operation_logs`/`agent_events`/`nexus_narrations`.

### Threat model STRIDE — nova superfície externa

Superfície nova nesta onda: endpoints `api/nexus/*`, ingestão de **voz** (STT), **tela** (vision) e
o caminho fala→ação. Threat model em
[`docs/security/threats/nexus-screen-vision.md`](../security/threats/nexus-screen-vision.md)
(criado/atualizado na onda). Resumo:

| STRIDE | Ameaça | Mitigação |
|---|---|---|
| **S**poofing | Chamar `api/nexus/*` sem ser o operador | Sessão JWT obrigatória (auth-first); sem rota anônima |
| **T**ampering | Forjar `action_id`/`client_id` para enfileirar fora de escopo | `action_id` single-use escopado à sessão; `client_id` validado contra `clients`; Zod |
| **R**epudiation | Negar quem disparou um job | `requested_by:'nexus'` + `operation_logs`/`agent_events` append-only com `run_id` |
| **I**nfo disclosure | Vazar segredo/PII via voz, tela ou log | Segredos server-only; logs sem PII; transcrição/frames efêmeros; leituras via service_role |
| **D**oS | Abusar de STT/TTS/chat (custo) ou floodar a fila | Rate limit por sessão; dedup por índice único parcial em `agent_jobs` |
| **E**lev. privilege | Prompt injection (fala/tela/scrape) executar skill arbitrária | Allowlist slug→skill; tools de escrita só enfileiram; conteúdo externo é dado, não instrução; confirmação 2-turnos |

## Critérios de aceite (gate da Onda 7)

Reproduz e fecha o gate da Onda 7 em [`WAVES.md`](../../WAVES.md) e SPEC-000 §8:

1. Comando de voz **"analisar cliente-exemplo"** retorna **métricas reais** (tool de leitura sobre
   o banco do seed), não mock.
2. Comando **"criar campanha"** exige **confirmação em dois turnos**: o 1º turno devolve
   `pending_action` (nada é gravado); só após o `confirm` com o `action_id` é criada **uma linha em
   `agent_jobs`** (`requested_by:'nexus'`, `status:'pending'`) que o runner executa.
3. O nome da skill é resolvido por **allowlist slug→skill server-side**; slug fora da allowlist não
   enfileira.
4. **Injeção de prompt** na fala/tela é tratada como **dado, não instrução** — não dispara skill
   nem altera a allowlist.
5. Dedup: confirmar duas vezes o mesmo `(client_id,kind)` ativo gera **1 job** (`already_queued`).
6. Todas as rotas `api/nexus/*` exigem **sessão**; sem sessão → 401.
7. `cd web && npm run lint && npm run typecheck && npm run build && npm test` — verdes.

## Testes

Pirâmide conforme `.claude/rules/testing.md` (muito unit, médio integração, pouco e2e).

- **Unit (`domain`/`application`, sem I/O):**
  - Resolução da allowlist: slug válido → skill esperada; slug inválido → erro.
  - Construção do `pending_action` e do payload de `agent_jobs` (campos/kind corretos, dinheiro em
    centavos quando aplicável).
  - Validação Zod: charset restrito recusa args maliciosos; limites de tamanho.
  - `action_id` single-use e expiração.
- **Integração (I/O — DB/REST):**
  - `POST /chat` "analisar cliente-exemplo" lê métricas do seed.
  - Fluxo dois turnos: `chat` (sem gravar) → `confirm` (insere 1 `agent_jobs`).
  - Dedup: 2º `confirm` ativo → `already_queued`, sem novo job.
  - Append-only: o Nexus não consegue UPDATE em `operation_logs`/`agent_events`/`nexus_narrations`.
  - Auth: rota sem sessão → 401.
- **e2e (seletivo):** caminho voz→ação completo (mock STT/TTS): falar "criar campanha" → confirmar
  → job em `agent_jobs`.
- **Segurança (regressão):** payload de prompt injection na transcrição e no `capture` **não**
  executa skill (red→green se reproduzir bug).
