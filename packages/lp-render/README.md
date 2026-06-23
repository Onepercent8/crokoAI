# @template/lp-render

Fonte única do domínio de landing pages do projeto (SPEC-011 / ADR 0013, 0017). Pacote **puro**:
sem I/O, sem rede, sem credenciais — builda e testa 100% offline.

Consumidores:

1. Skills do runner (`create-landing-page-<cliente>`, `publish-landing-page-<cliente>`) — montam e
   serializam a `ContentDoc`.
2. `landing-pages/_template` — renderiza as seções no build estático.
3. Editor do dashboard (Onda 9) — valida/edita campos por seção com os mesmos schemas Zod.

## O que exporta

- **Tipos/schemas:** `ContentDoc`, `Theme`, `Settings` e o catálogo fechado das **17 seções**
  (`SECTION_TYPES`, `SECTION_FIELD_SCHEMAS`). Validação por Zod na fronteira (entrada = dado).
- **Serializer:** `serialize(doc) -> { "messages/pt.json", "content-spec.json", "theme.css" }`.
  Determinístico (mesma `ContentDoc` ⇒ mesmos artefatos), suporta idempotência do publish.
- **Libs de apresentação (puras):** `utm`, `affiliate`, `checkout`, `consent`.

## Contratos

- **Dinheiro em inteiro de centavos** (`priceCents`); nunca float. Exibição derivada via
  `formatCentsBRL`.
- **Catálogo fechado:** só os 17 tipos; cada `fields` é `.strict()` (rejeita campo desconhecido).
- Sem segredos/PII no código (domínio puro).

## Scripts

```bash
npm run build      # tsc -> dist/ (.js + .d.ts)
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```
