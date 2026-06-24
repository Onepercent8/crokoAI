# ADR 0007 — Revalidação fail-closed na ativação de campanha

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 5

## Contexto

A ativação (kind `activate`) é a **única operação do sistema que inicia gasto real** numa conta
Meta: ela vira uma entidade de `PAUSED` para `ACTIVE`. Tudo até a Onda 4 nasce PAUSED e é
read-only ou cria entidades desligadas; a Onda 5 abre a porta do dinheiro.

Forças em jogo (SPEC-000 §8 Onda 5/§10/§11):

- A skill é **headless** (`claude -p`), acionada por fila (`agent_jobs`) ou por agenda. O job traz
  args (`client_slug`, `meta_entity_id`) que vêm, em última instância, de um operador ou do Nexus —
  **dados não confiáveis**. Confiar só no arg para decidir ligar é *Tampering*/*Elevation* (STRIDE):
  ativar a entidade errada, de outro cliente, ou uma que já está fora do teto de orçamento.
- O estado real na Meta pode ter **mudado** entre a criação/validação (Onda 2) e a ativação
  (orçamento alterado, entidade pausada por terceiro, conta trocada). O snapshot do banco pode estar
  **stale**.
- Erro aqui custa **dinheiro real** e é difícil de reverter (gasto já incorrido). O viés correto é
  **não ligar na dúvida**, não "ligar e corrigir depois".

Alternativas consideradas:

- **Confiar no estado persistido no Supabase** (status/orçamento da última escrita): rápido, mas
  pode estar desatualizado em relação à Meta — não protege contra mudanças fora-de-banda.
- **Ativar e validar depois** (otimista, com rollback): inaceitável — o gasto começa antes da
  validação; rollback não devolve o dinheiro gasto.
- **Caminho de "força" / override** (`confirm=true`): cria um atalho que, sob injeção/erro, liga
  gasto sem validação. Viola "validação antes da lógica".

## Decisão

A ativação é **fail-closed**: antes de qualquer flip, a skill **re-lê a entidade diretamente na
Meta** (`MetaActivationPort.getEntity`) e revalida com `assertActivationSafe`, exigindo **todas** as
condições simultaneamente:

1. a entidade lida é exatamente a `meta_entity_id` pedida (sem troca de alvo);
2. seu `ad_account_id` é o do cliente resolvido por **allowlist server-side por slug** (sem
   ativação cross-client);
3. o status atual é **PAUSED** (só ligamos o que está desligado);
4. `daily_budget_cents` atual ≤ `clients.daily_budget_cap_cents` (sem gasto acima do teto).

Qualquer divergência **aborta** (`throw`) com manifest `failed` e **sem nenhum flip**. **Não existe
caminho de força.** Após o flip (`activateEntity`), a skill **reconfere o status efetivo**: se não
virou `ACTIVE`, aborta. Só então grava **1 `operation_logs`** (`action='activate'`, append-only).

A porta `MetaActivationPort` expõe **apenas** `getEntity` (leitura) e `activateEntity` (a única
mutação estritamente necessária) — **least privilege**: a skill não consegue pausar, apagar nem
mudar orçamento, nem por bug. A entidade já `ACTIVE` é **no-op idempotente** (`skipped`), sem segundo
flip nem novo log. Toda a lógica é pura e injetável (`orchestrateActivation` sobre portas), testada
offline com fakes.

## Consequências

- **+** O único caminho que gasta dinheiro exige revalidação completa contra o estado **vivo** da
  Meta; mudanças fora-de-banda (orçamento, pausa, conta) são detectadas e bloqueiam a ativação.
- **+** Superfície mínima de mutação (só `activateEntity`) reduz o raio de dano de um bug/injeção.
- **+** Idempotência por estado (`ACTIVE` = no-op) torna o re-run seguro sob a fila/cron.
- **+** `action='activate'` em `operation_logs` dá trilha de auditoria do momento exato em que o
  gasto começou (append-only, sem PII).
- **−** Uma chamada de leitura extra à Meta por ativação (latência/quota desprezível para 1 flip).
- **−** Ativações legítimas podem ser **bloqueadas** se o estado vivo divergir (ex.: orçamento subiu
  acima do teto fora-de-banda) — é o trade-off desejado: prefere-se um falso-negativo (não liga, pede
  revisão) a um falso-positivo (liga errado). O operador corrige o estado e re-roda.
- **−** A ausência de override significa que casos extraordinários exigem ajustar o estado real
  (orçamento/conta) antes de re-tentar, em vez de "forçar" — intencional.
