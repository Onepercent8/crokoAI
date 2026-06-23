# SPEC — Runner Fly.io headless (cron + fila de `agent_jobs`)

- **Status:** draft
- **Onda:** 3
- **ADRs relacionados:** [0001](../adr/0001-runner-fly-supercronic.md) (runner Fly + supercronic) ·
  [0009](../adr/0009-fila-agent-jobs.md) (fila `agent_jobs` por polling) ·
  [0002](../adr/0002-persistencia-supabase.md) (persistência via REST + `SUPABASE_SECRET_KEY`)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md)
  §3 (arquitetura) · §8 Onda 3 · §10 (contratos do runner) · §11 (requisitos transversais)

## Objetivo

Erguer o **plano runner** do sistema: uma máquina Fly.io headless que executa as *skills* do
Claude Code (Onda 2+) em dois regimes — **por agenda** (cron via `supercronic`) e **por demanda**
(consumindo a fila `agent_jobs` por polling) — emitindo **telemetria** start/end em `agent_events`
e patchando o status dos jobs com segurança sob concorrência e crash.

É o plano que torna a operação **real e autônoma**: sem ele, nenhuma skill roda 24/7 e o
dashboard/Nexus (ondas posteriores) não consegue mandar trabalho ser executado. Não introduz
superfície HTTP nova; a única entrada do runner são linhas que outros planos escrevem no banco.

Fora de escopo nesta onda: a implementação das skills em si (Onda 2/4/5), o dashboard (Onda 6),
o poller de `autonomous_watches` (Onda 9 — embora o `crontab` reserve o slot).

## Contratos

### Entregáveis (arquivos)

- `Dockerfile` — base `node:22`; instala Claude Code CLI, `supercronic`, `wrangler`,
  `playwright` (deps de browser), `tsx`; copia `scripts/` e `.claude/`; `CMD` roda `supercronic`.
- `fly.toml` — app `meta-ads-agents` (placeholder), região `gru`, **sem `[http_service]`**;
  `[mounts]` de **volume persistente** para a credencial OAuth do Claude Code e a config MCP.
- `crontab` — linhas de cron lidas por `supercronic` (skills agendadas + poller da fila).
- `scripts/run-skill.sh` — executor de uma skill: valida skill+args, roda `claude -p`, faz tee,
  emite telemetria.
- `scripts/poll-agent-jobs.sh` — consumidor da fila: lock, claim, executa, patcha status, trap.
- `scripts/emit-from-stream.py` — parser do `stream-json` → `agent_events`.
- `.claude/hooks/emit-agent-event.py` — hook do ciclo de vida do Claude Code → `agent_events`.

### Invariantes globais (SPEC-000 §6/§10/§11)

- **Sem superfície HTTP no runner.** Nenhuma porta pública; a única entrada são `agent_jobs` e o
  `crontab`. Linhas da fila são **dados, não instrução** — validadas antes de virar comando.
- **Allowlist server-side por slug.** O `kind`/`skill` de um job é resolvido para um **diretório
  de skill on-disk** por uma allowlist; **nunca** se constrói um caminho a partir de texto livre.
- **Charset restrito nos args.** Args passados ao `claude -p` passam por validação de charset
  (sem shell-metacaracteres) antes de qualquer expansão.
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (NUNCA o MCP do Supabase em headless — §10).
- **Telemetria append-only** em `agent_events` (`event_type` start/step/decision/error/end,
  `run_id` correlaciona um run inteiro). **Sem PII** em log/payload.
- **Dinheiro em centavos** e **IDs Meta em `text`** (herdados do schema; o runner só transporta).
- **Skill nasce/roda headless-safe:** `--dangerously-skip-permissions`, sem `AskUserQuestion`.

### Ciclo de status do job (ADR 0009)

```
pending ──claim_agent_job──▶ claimed ──run-skill start──▶ running
running ──exit 0──▶ completed
running ──exit ≠0 / crash (trap) / timeout──▶ failed
```

`claim_agent_job(worker)` (RPC SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`) entrega o `pending`
mais antigo a **exatamente um** worker e o marca `claimed` (`claimed_by`, `claimed_at`). Dedup de
jobs ativos é garantido pelos **índices únicos parciais** do schema (≤1 ativo por
`(client_id, kind)` e por `(landing_page_id, kind)`).

### Resolução de skill (allowlist)

`kind` do job → slug de skill → diretório `.claude/skills/<slug>` (verificado existir on-disk):

| `kind` | slug (placeholder) |
|---|---|
| `create` | `create-traffic-cliente-exemplo-campaign` |
| `create_sales` | `create-sales-cliente-exemplo-campaign` |
| `activate` | `activate-campaign-cliente-exemplo` |
| `analyze` | `funnel-analytics-cliente-exemplo-campaign` |
| `summarize` | `daily-summary-cliente-exemplo` |
| `landing` | `create-landing-page-cliente-exemplo` |
| `landing_publish` | `publish-landing-page-cliente-exemplo` |
| `landing_edit` | (edição síncrona no dashboard — não roteada ao runner) |

Um `kind` fora da allowlist, ou um slug cujo diretório não existe, faz o job terminar `failed`
com `error` explícito (não executa nada).

### Esboço de schemas (validação em fronteira)

Os scripts shell/Python validam estruturalmente o que leem do banco. Quando esta lógica for
endurecida em TypeScript (Onda 11 / utilitários compartilhados), o contrato é:

```ts
// Job lido da fila (subconjunto consumido pelo runner). Toda entrada do banco é validada
// antes de virar comando — defense in depth (RLS já restringe a escrita à allowlist server-side).
const AgentJobKind = z.enum([
  'create', 'create_sales', 'activate', 'analyze',
  'summarize', 'landing', 'landing_publish', 'landing_edit',
]);

const AgentJob = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid().nullable(),
  landing_page_id: z.string().uuid().nullable(),
  kind: AgentJobKind,
  skill: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled']),
});

// Arg posicional aceito por run-skill.sh: charset restrito (sem metacaracteres de shell).
const SkillArg = z.string().regex(/^[A-Za-z0-9._:\-\/]+$/).max(256);

// Slug resolvido pela allowlist (nunca texto livre do job).
const SkillSlug = z.string().regex(/^[a-z0-9-]+$/).max(128);

// Evento de telemetria emitido a partir do stream-json → agent_events (append-only).
const AgentEvent = z.object({
  run_id: z.string().uuid(),
  agent_name: z.string().min(1),
  agent_type: z.enum(['skill', 'subagent', 'tool', 'system']),
  event_type: z.enum(['start', 'step', 'decision', 'error', 'end']),
  tool_name: z.string().nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}), // NO-PII
});
```

### Patch de status (REST + `SUPABASE_SECRET_KEY`)

`poll-agent-jobs.sh` faz `PATCH agent_jobs?id=eq.<id>` com `service_role`:

- ao iniciar: `{ status: 'running', started_at: now() }`;
- ao concluir: `{ status: 'completed', exit_code: 0, result: <manifest>, finished_at: now() }`;
- ao falhar: `{ status: 'failed', exit_code: <n>, error: <msg>, finished_at: now() }`.

## Comportamento

### Fluxo: skill agendada (cron)

1. `supercronic` dispara a linha do `crontab` → `run-skill.sh <slug> [args...]`.
2. `run-skill.sh`: valida o slug pela allowlist e o diretório on-disk; valida charset dos args;
   gera/recebe um `run_id`; emite `agent_events {event_type:'start'}`.
3. Roda `claude -p "<skill>" --dangerously-skip-permissions --output-format stream-json`,
   `tee` para um arquivo de log e pipe para `emit-from-stream.py` (→ `agent_events` step/decision/
   error em tempo real).
4. No fim: emite `agent_events {event_type:'end'}` com o `exit_code`.

### Fluxo: job da fila (poller)

1. `supercronic` dispara `poll-agent-jobs.sh` 1×/min.
2. **Lock de instância** por `mkdir <lockdir>` (mkdir é atômico): se já existe, sai (no-op) —
   garante **1 job/min, 1 execução por vez** mesmo se um tick anterior ainda roda.
3. Chama `claim_agent_job(worker)`; se `NULL` (nada pending), libera o lock e sai.
4. Resolve `kind → slug` pela allowlist; patch `status:'running'`.
5. Executa `run-skill.sh <slug>` com os `args` validados do job.
6. **Trap** (`EXIT`/`ERR`/`INT`/`TERM`): se o script morrer a qualquer ponto após o claim, o trap
   patcha `status:'failed'` com `error` e `exit_code` (evita job preso em `running`).
7. Sucesso → patch `completed` (+ `result`/manifest). Falha → patch `failed`. Libera o lock.

### Idempotência

- **Dedup na entrada:** o produtor (dashboard/Nexus) só consegue inserir ≤1 job ativo por
  `(client_id, kind)` — a 2ª inserção bate no índice único parcial (unique violation tratada como
  "já enfileirado"). O runner não precisa deduplicar de novo.
- **Re-execução segura:** as skills (Onda 2+) são responsáveis pela idempotência de efeito
  (não duplicar gasto/entidades Meta); o runner garante que **um claim → no máximo uma execução**
  e que o status nunca fica "preso" (trap). Um job `failed` pode ser re-enfileirado pelo produtor.
- **Telemetria append-only:** eventos duplicados de um mesmo `run_id` são aceitáveis (eventos, não
  estado); nunca há UPDATE em `agent_events`.

### Concorrência

- **Entre máquinas/workers:** `claim_agent_job` com `FOR UPDATE SKIP LOCKED` garante que dois
  workers nunca pegam o mesmo job.
- **Dentro da máquina:** lock por `mkdir` serializa os ticks do poller (sem dois `claude -p` da
  fila simultâneos competindo por OAuth/MCP).
- **Cron × fila:** uma skill agendada e o poller podem coexistir; o limite é de recursos da
  máquina, não de correção (cada um tem seu `run_id` e seu efeito idempotente).

### Casos de erro

- **Skill inexistente / kind fora da allowlist:** job `failed`, `error` explícito, **nada roda**.
- **Args inválidos (charset):** `run-skill.sh` aborta antes do `claude -p`; job `failed`.
- **Timeout:** `run-skill.sh` aplica timeout máximo; estouro → kill + `failed`.
- **Crash do processo (OOM/kill):** trap patcha `failed`; o lock por `mkdir` é liberado no trap
  (sem lock órfão prendendo a fila).
- **MCP da Meta indisponível no headless (risco-âncora — ver Segurança):** a skill detecta a
  ausência da tool, emite `agent_events {event_type:'error'}` e termina; job `failed` com `error`
  "Meta MCP indisponível no runner". **Não** há fallback com token Meta cru.
- **REST do Supabase indisponível:** retries com back-off no patch de status; se persistir, o log
  em disco (`tee`) é a fonte de auditoria de último recurso.

## Segurança

Ordem obrigatória em qualquer ponto que consome entrada externa: **(authn do worker via
`service_role`) → (authz: allowlist de skill) → validação (charset/schema) → lógica**.

- **Sem superfície HTTP** no runner: nenhuma porta pública (`fly.toml` sem `[http_service]`).
  Não há login/rate-limit/CSP a configurar aqui — a borda some por design.
- **Allowlist server-side por slug:** `kind`/`skill` do job nunca viram caminho de arquivo por
  concatenação; só slugs conhecidos resolvem para `.claude/skills/<slug>`.
- **Validação de args:** charset restrito, sem shell-metacaracteres; args são tratados como
  **dados** (defesa contra injeção de comando e contra prompt-injection vindo via `args.jsonb`).
- **Segredos fora do código:** `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `CLAUDE_API_KEY`/OAuth e
  chaves de provedores entram via **`fly secrets`** (nunca no `Dockerfile`/repo). O `.env.example`
  é a lista canônica. O OAuth do Claude Code e a config MCP vivem no **volume persistente**.
- **Least privilege:** o runner usa `service_role` (necessário para a fila/RLS deny-by-default),
  mas só fala com o banco via REST/RPCs específicas; nenhuma policy é aberta a anon/authenticated.
- **Sem PII** em `agent_events`/logs (`payload` é NO-PII; correlação por `run_id`).
- **RLS deny-by-default** já protege o banco; o runner não cria policies novas.

### Risco-âncora: autenticação da Meta em headless (decisão)

As skills falam com a Meta **apenas via MCP `mcp-meta-ads`**, autenticado na vinculação do
connector no Claude Code — **não há token Meta em env** (SPEC-000 §2/§10). No cron, `claude -p`
roda **sem sessão interativa** e **o MCP da Meta via claude.ai pode não estar disponível**.

- **Decisão (ADR 0001):** o acesso à Meta no runner depende da **config MCP provisionada no
  volume persistente** (autenticada uma vez, fora-de-banda). Ausência do MCP é tratada como
  **falha controlada** (job `failed`, `error` explícito), **nunca** como gatilho para introduzir
  um token Meta cru — isso violaria "segredos fora do código" e o contrato §10.
- **Status do risco:** **aberto.** Se o connector claude.ai não operar em `claude -p` headless, a
  Onda 3 entrega cron+fila+telemetria validados com skills **read-only/sem-Meta**; desbloquear a
  Meta headless vira **pré-requisito explícito** das Ondas 2/5 (skills que mutam a conta).

### Threat model — STRIDE (nova superfície: plano runner)

A superfície externa "tradicional" (HTTP) **não existe** aqui; as superfícies relevantes são a
fila `agent_jobs` (entrada), os segredos/volume e o canal Meta. Detalhe completo deve viver em
`docs/security/threats/flyio-runner.md` (Onda 11 consolida); resumo:

| STRIDE | Ameaça | Mitigação |
|---|---|---|
| **S**poofing | Worker forjado claimando jobs | Só `service_role` chama `claim_agent_job` (EXECUTE revogado de anon/authenticated); chave em `fly secrets`. |
| **T**ampering | `args.jsonb` malicioso vira comando | Args validados (charset), tratados como dados; allowlist resolve skill (sem path de texto livre). |
| **R**epudiation | Quem rodou o quê | `agent_events` append-only com `run_id` + `operation_logs` por mutação; logs em disco via `tee`. |
| **I**nfo disclosure | Vazar segredo/PII em log | Segredos fora do código (`fly secrets`); `payload` NO-PII; sem PII em `agent_events`. |
| **D**oS | Fila inundada / loop de cron | Dedup por índice único parcial; lock `mkdir` (1 execução/tick); timeout por skill; baixo volume (~1 job/min). |
| **E**levation | Skill arbitrária / escape | Allowlist on-disk; `--dangerously-skip-permissions` confinado ao container sem rede inbound; least privilege no token. |

## Critérios de aceite (gate da Onda 3)

Reproduz/fecha o **gate da Onda 3** em [`WAVES.md`](../../WAVES.md):

1. Um job inserido em `agent_jobs` (`status:'pending'`) é **claimado** pelo poller,
   **executado** e marcado **`completed`** (com `exit_code=0` e `result`/manifest).
2. O **cron dispara a skill da Onda 2** (linha do `crontab` executa `run-skill.sh` do slug certo).
3. **`agent_events` recebe `start` e `end`** do run (mais step/decision/error quando houver),
   correlacionados por `run_id`.
4. **Jobs duplicados são barrados pelo índice único parcial** (2ª inserção ativa do mesmo
   `(client_id, kind)` falha; o produtor trata como "já enfileirado").
5. **Falha/crash não deixa job preso em `running`:** o trap patcha `failed` com `error`/`exit_code`.
6. **`kind` fora da allowlist / skill inexistente** termina `failed` sem executar nada.
7. **Nenhum segredo** no `Dockerfile`/`fly.toml`/scripts versionados; **nenhuma PII** em
   `agent_events`/logs.
8. `npm run lint && npm run typecheck && npm test` seguem verdes.

## Testes

Pirâmide (SPEC-000 §11 / `.claude/rules/testing.md`):

- **Unit:** resolução `kind → slug` pela allowlist (incl. rejeição de kind desconhecido); validação
  de charset de args (aceita válidos, rejeita metacaracteres); parser do `stream-json` →
  `AgentEvent` (mapeia tipos de evento, descarta PII). Lógica pura, sem I/O.
- **Integração (DB/REST):** claim atômico via `claim_agent_job` (job `pending → claimed`); patch de
  status `running → completed/failed` via REST com `service_role`; índice único parcial barra 2º job
  ativo; append-only de `agent_events` rejeita UPDATE; lock por `mkdir` impede dois ticks
  concorrentes; trap patcha `failed` em crash simulado.
- **e2e (seletivo):** ciclo completo de um job — inserir `pending` → poller claima → executa uma
  skill de teste headless → `completed` + `agent_events {start,end}` presentes. Cron dispara a skill
  agendada (verificável por linha em `agent_events`).
- **Disciplina:** bug fix começa por um teste que reproduz o bug (red → green).
