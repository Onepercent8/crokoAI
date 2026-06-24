---
name: activate-campaign-cliente-exemplo
description: Liga (ACTIVE) uma campanha/ad set/ad PAUSED do cliente-exemplo que JÁ passou pela revalidação fail-closed (cliente correto, PAUSED, dentro do teto). É a única skill que inicia gasto real. Revalida na Meta antes de ligar e aborta na dúvida. Headless-safe. Loga operation_logs com action=activate.
allowed-tools: Read, Bash, mcp__mcp-meta-ads__get_campaign, mcp__mcp-meta-ads__get_adset, mcp__mcp-meta-ads__get_ad, mcp__mcp-meta-ads__update_campaign, mcp__mcp-meta-ads__update_adset, mcp__mcp-meta-ads__update_ad
---

# Skill — activate-campaign-cliente-exemplo (Onda 5, kind `activate`)

> Implementa o contrato de
> [`docs/specs/meta-ads-activation-and-sales.md`](../../../docs/specs/meta-ads-activation-and-sales.md).
> A orquestração (revalidação fail-closed → ativação → operation_log → manifest) vive em
> `@template/skill-kit`: `orchestrateActivation(args, deps)`
> (`packages/skill-kit/src/application/orchestrate-activation.ts`), testada offline com fakes. Esta
> SKILL.md liga as **portas** (`ports.ts`) aos adapters reais: Meta via MCP `mcp-meta-ads`
> (`getEntity`/`activateEntity`), catálogo via REST. O e2e real depende do MCP `mcp-meta-ads` e de
> uma campanha PAUSED existente (pendente de credenciais).

## É a ÚNICA skill que inicia gasto real — fail-closed por padrão

- **Revalida ANTES de ligar** (`assertActivationSafe`): re-lê a entidade na Meta e exige
  TODAS as condições: (1) a entidade lida é exatamente a `meta_entity_id` pedida; (2) pertence ao
  `ad_account_id` do cliente; (3) está **PAUSED**; (4) `daily_budget_cents` ≤
  `clients.daily_budget_cap_cents`. **Qualquer dúvida → aborta** (não há caminho de força).
- **Mutação mínima:** a porta `MetaActivationPort` só expõe `getEntity` (leitura) e
  `activateEntity` (a única escrita estritamente necessária). Sem pause/delete/mudança de orçamento.
- **Idempotente:** entidade já `ACTIVE` → no-op (`skipped`), sem segundo flip.
- **`operation_logs` por ativação** (append-only, `action='activate'`, sem PII/segredos).
- **Persistência só via REST + `SUPABASE_SECRET_KEY`** (PostgREST) — **NUNCA** o MCP do Supabase.
- **Headless-safe:** roda em `claude -p --dangerously-skip-permissions`. **NUNCA** `AskUserQuestion`.

## Entradas (args — charset restrito)

```json
{
  "client_slug": "cliente-exemplo",
  "meta_entity_id": "1203...PAUSED-id",
  "entity_type": "campaign",
  "idempotency_key": "opcional"
}
```

`client_slug` casa `^[a-z0-9-]+$`; `meta_entity_id` casa `^[A-Za-z0-9_:-]+$` (id externo da Meta é
text). Validar com `ActivateArgsSchema` (de `@template/skill-kit`).

## Procedimento (determinístico)

1. **Validar args** com `ActivateArgsSchema`. Resolver `idempotency_key`.
2. **Resolver cliente** por REST (allowlist server-side por slug): `ad_account_id`,
   `daily_budget_cap_cents`.
3. **Re-ler a entidade na Meta** (`get_campaign`/`get_adset`/`get_ad`) → status, `ad_account_id`,
   `daily_budget_cents` atuais. **Nunca** confiar nos args para a decisão de ligar.
4. **Idempotência:** se já `ACTIVE`, escrever manifest `skipped` e sair (sem flip).
5. **Revalidar fail-closed** com `assertActivationSafe`. Abortar na menor divergência.
6. **Ligar** (`update_* status=ACTIVE`) e **verificar** o novo status efetivo. Se não virou `ACTIVE`,
   abortar (manifest `failed`).
7. **Gravar 1 `operation_logs`** (`action='activate'`, ator `skill:activate-campaign`).
8. **Escrever manifest** `completed` em `tentativas-geracao-de-campanhas/<stamp>-activate.json`. Em
   qualquer aborto, manifest `failed` com `error` (sem PII/segredos).

## Erros (resumo)

- Entidade não-PAUSED / conta errada / id divergente / orçamento acima do teto → **aborta antes do
  flip**; manifest `failed`.
- Flip não confirmado pela Meta → aborta; manifest `failed`.
- Padrão de erro: log estruturado **sem PII** + `throw new Error("Failed to activate campaign: …")`.

## Observabilidade

`run_id` único por execução, propagado aos `agent_events` e gravado no manifest. Logs sem PII;
segredos nunca no manifest/log.
