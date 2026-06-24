# Threat model (STRIDE) — Editor de landing + modo autônomo (Onda 9)

- **Superfície:** editor de LP no dashboard (`components/landing/*` + API `lib/api/landing-pages.ts`)
  e o modo autônomo do Nexus (`lib/nexus/{autonomous-mode,review-frame,live-review}`,
  skill `autonomous-watch-tick`, `scripts/screenshot-page.cjs`, `scripts/send-email.cjs`).
  Edições mutam **rascunho** (`landing_page_sections`); o screenshotter busca URLs externas.
- **Spec/ADR:** SPEC-012 (editor) · SPEC-013 (modo autônomo) · SPEC-014 (live review) · [ADR 0015](../../adr/0015-lp-editavel-no-supabase.md) · [ADR 0019](../../adr/0019-modo-autonomo-nexus.md) · [ADR 0020](../../adr/0020-live-review.md)
- **Fonte:** SPEC-000 §8 Onda 9 · §10 · §11 · `.claude/rules/security.md`

## Ativos

- Conteúdo das landing pages (`landing_pages.settings/theme` + `landing_page_sections.fields`).
- Fila de watches (`autonomous_watches`) + narrações (`nexus_narrations`).
- Screenshots de páginas (capacidade de fetch externo → vetor de SSRF).
- Segredos: `SUPABASE_SECRET_KEY` (escrita server-side), `RESEND_API_KEY` (email opcional).

## Fronteira / fluxo

Operador edita campo no dashboard → **auth (sessão)** → **validação Zod por seção**
(`edit-path` + `reconcile`) → escreve `landing_page_sections` (rascunho). Publish é job
**pesado enfileirado** (`landing_publish`), não síncrono. Modo autônomo: `autonomous-watch-tick`
é máquina de fases (`watching→reviewing→notifying→done`), **1 narração por tick**,
idempotente por cursores; o screenshotter roda no runner com **SSRF-guard `*.example.com`**.

## STRIDE

| Categoria | Ameaça | Mitigação | Onde |
|---|---|---|---|
| **S**poofing | Editar LP de outro cliente / iniciar watch sem sessão | API de edição atrás do gate de sessão do dashboard (`middleware.ts`); escopo por `landing_page_id`/`client_id`; escrita só com `service_role` server-side. | `middleware.ts`, `lib/api/landing-pages.ts` |
| **T**ampering | Forjar `edit-path` para escrever campo/seção arbitrária; injetar HTML na LP | **Validação Zod por seção** com `edit-path` allowlistado + `reconcile` (só campos conhecidos da seção); conteúdo da LP é dado renderizado pelo `@template/lp-render` (sem `dangerouslySetInnerHTML` de input livre). | `lib/api/landing-pages.ts`, `@template/lp-render` |
| **R**epudiation | Edição/narração sem rastro | Edição muta `landing_page_sections` (com `updated_at` por trigger); cada tick insere ≤1 `nexus_narrations` (append-only); publish vira `agent_jobs` rastreável. | `landing_page_sections`, `nexus_narrations` |
| **I**nfo disclosure | SSRF: screenshotter buscar `http://169.254.169.254/` (metadata) ou rede interna; vazar email | **SSRF-guard**: o screenshotter só navega para hosts `*.example.com` (allowlist por sufixo); email (Resend) degrada para log em falha, sem vazar destinatário no log; sem PII. | `scripts/screenshot-page.cjs`, `scripts/send-email.cjs` |
| **D**oS | Watches em loop / publish em massa esgotando o runner | Watch idempotente por cursores (não re-processa); poller processa **1 watch/tick** (~90s); publish é job único barrado por índice parcial (landing,kind); fail-safe (email/telegram → log). | `scripts/poll-autonomous-watches.sh`, `autonomous_watches` |
| **E**levation | Editor escalar de rascunho para publicação/go-live sem passo humano | Edição só toca **rascunho** (`noindex`); publish é job enfileirado separado; **go-live (indexável) é passo manual** (SPEC-000 §8 Onda 8); o autônomo narra/sugere, não publica sozinho. | `lib/api/landing-pages.ts`, fluxo publish (Onda 8) |

## Riscos residuais / follow-ups

- **Onda 9 ainda ⬜ (não implementada).** Este modelo orienta a implementação; revisar e
  fechar quando o editor/autônomo existirem em código.
- SSRF-guard por sufixo `*.example.com` depende de resolução de DNS confiável; reforço
  futuro: bloquear faixas privadas/link-local por IP após resolução (anti-rebinding).
- `screenshot-page.cjs` usa Playwright headless — manter o browser atualizado (CVE) e sem
  acesso a credenciais do volume `/data`.
- Email via Resend é opcional e degrada para log; nunca colocar conteúdo da LP/PII no corpo
  do log de fallback.
</content>
