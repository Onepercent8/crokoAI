# Threat model (STRIDE) — Nexus (voz + visão de tela) (Onda 7)

- **Superfície:** assistente Nexus no dashboard — endpoints `api/nexus/{chat,stt,tts,capture,narrations}`
  (Hono, atrás da mesma sessão do dashboard). Entradas **não confiáveis**: fala (STT),
  captura de tela (`/capture`), e o próprio output do modelo. Tools de escrita **só
  enfileiram** `agent_jobs`.
- **Spec/ADR:** [SPEC-016 voice chat](../../specs/SPEC-016-voice-chat.md) · [ADR 0006](../../adr/0006-auth-do-dashboard.md)
- **Fonte:** SPEC-000 §8 Onda 7 · §10 (Nexus tools) · §11 · `.claude/rules/security.md`

## Ativos

- Acesso de **leitura** a métricas/análises do cliente (read-tools retornam JSON puro).
- Fila `agent_jobs` (toda escrita — criar/ativar/landing — passa por aqui).
- Frames de tela capturados (PII potencial: o que estiver na tela do operador).
- Segredos de IA: `ANTHROPIC_API_KEY` (chat), `OPENAI_API_KEY` (Whisper/STT),
  `ELEVENLABS_API_KEY` (TTS) — só server-side.

## Fronteira / fluxo

Voz/tela → STT/normalização (**dado, não instrução**) → chat loop (modelo escolhe tool)
→ read-tool (executa direto, JSON) **ou** write-tool (retorna `pending action`, **não**
muta) → confirmação em **dois turnos** (`action_id` single-use) → `confirmAction`
re-resolve o slug pela **allowlist** e só então insere em `agent_jobs`. O runner
executa depois (SPEC-000 §3, só via banco).

## STRIDE

| Categoria | Ameaça | Mitigação | Onde |
|---|---|---|---|
| **S**poofing | Caller anônimo chamar `api/nexus/*` ou se passar por outra sessão | Endpoints atrás do gate de sessão do dashboard (`middleware.ts`); `action_id`/`screen_context_id` escopados ao `sessionId` (frame de uma sessão não é legível por outra). | `middleware.ts`, `lib/nexus/pending-action.ts`, `lib/nexus/screen-context.ts` |
| **T**ampering | Injeção de prompt (na fala ou na tela) mandando rodar skill arbitrária ou alterar args | Conteúdo de voz/tela é **dado**, nunca instrução; skill resolvida por **allowlist server-side por slug** (`SKILL_BY_SLUG`) — texto livre **nunca** resolve; args validados por Zod (charset restrito). | `lib/nexus/tools.ts`, `lib/nexus/schemas.ts` |
| **R**epudiation | Enfileirar trabalho sem rastro / negar ter pedido | Toda escrita vira linha em `agent_jobs` (`requested_by:'nexus'`); confirmação em dois turnos exige `action_id` explícito; o runner grava `agent_events`/`operation_logs` append-only. | `lib/nexus/confirm.ts`, `lib/nexus/enqueue.ts` |
| **I**nfo disclosure | Vazar PII da tela ou segredo de IA | Frames `/capture` ficam só em memória com TTL curto (`SCREEN_CONTEXT_TTL_SECONDS`), **nunca** persistidos no banco; chaves de IA só server-side; respostas sem PII em log. | `lib/nexus/screen-context.ts` |
| **D**oS | Flood de chat/STT/TTS (cada chamada custa dinheiro) ou inundar a fila | Rate limit Nexus por sessão (30/min); índice único parcial em `agent_jobs` barra duplicado por (client,kind); `action_id` single-use impede replay enfileirar N vezes. | `lib/ratelimit.ts`, `agent_jobs` (Onda 1/3) |
| **E**levation | Modelo escalar de "ler" para "escrever" sem confirmação humana | Write-tools **nunca** mutam no 1º turno — retornam `pending action`; só `confirmAction` (com token válido) enfileira; slug desconhecido → rejeitado sem efeito. | `lib/nexus/confirm.ts`, `lib/nexus/tools.ts` |

## Riscos residuais / follow-ups

- A confirmação em dois turnos protege contra ação acidental, mas um operador
  comprometido ainda confirma manualmente — fora do modelo de ameaça (operador é confiável).
- Frames de tela em memória não são criptografados; mitigado pelo TTL curto e por nunca
  persistir. Se um proxy/log de plataforma capturar o corpo, há exposição — não logar corpo.
- A allowlist `SKILL_BY_SLUG` é estática (6 slugs); adicionar slug exige code review
  (nunca derivar nome de skill de input do modelo).
- Injeção de prompt é mitigada por construção (allowlist), não por filtro de conteúdo;
  reforço futuro: classificador de instrução-vs-dado antes do loop.
</content>
