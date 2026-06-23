---
name: daily-summary-cliente-exemplo
description: Consolida as análises do dia do cliente-exemplo num upsert em daily_summaries (client_id + summary_date único). Notificação Telegram OPCIONAL com fallback log-only. READ-ONLY na Meta. Headless-safe.
allowed-tools: Read, Bash
---

# Skill — daily-summary-cliente-exemplo (Onda 4)

> Implementa o contrato §"Fluxo daily-summary" de
> [`docs/specs/meta-ads-funnel-analytics.md`](../../../docs/specs/meta-ads-funnel-analytics.md).
> Idempotente por construção: o **upsert** em `daily_summaries` por `(client_id, summary_date)`
> re-escreve a mesma linha (rodar de novo no mesmo dia atualiza, não duplica).

## Garantias inegociáveis

- **READ-ONLY na Meta** (apenas lê `analyses` do dia no banco; não toca a conta Meta).
- **Sem PII** em `summary`/`structured`/manifest/logs — só métricas, verdicts e flags.
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (nunca MCP do Supabase).
- **Telegram opcional**: em falha, **degrada para log-only** (não falha a skill).
- **Manifest JSON** + `operation_logs`.

## Entrada (args — validados por `DailySummaryArgsSchema`)

```json
{ "client_slug": "cliente-exemplo", "summary_date": "2026-06-23", "notify_telegram": false }
```

## Procedimento

1. Validar args; resolver cliente.
2. Ler as `analyses` do dia (`summary_date`).
3. Consolidar `summary` legível + `structured jsonb` (por campanha, verdicts, top findings, deltas).
4. **Upsert** `daily_summaries` por `(client_id, summary_date)`.
5. Se `notify_telegram`, tentar enviar; em falha, log-only.
6. Manifest + `operation_logs`.

## Pendente para o e2e real

env CrokoAI (REST). `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` opcionais; ausência ⇒ log-only.
