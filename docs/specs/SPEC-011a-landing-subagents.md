# SPEC-011a — Subagents da landing page: `landing-page-architect` e `lp-copywriter`

- **Status:** draft
- **Onda:** 8 (complemento de [SPEC-011](./SPEC-011-landing-generation.md))
- **ADRs:** [0013](../adr/0013-design-system-da-lp.md) (catálogo de 17 seções) ·
  [0017](../adr/0017-pacote-lp-render.md) (`@template/lp-render`)

> O registro executável dos subagents vive em `.claude/agents/` (fora do domínio desta frente).
> Esta spec define os **contratos** (entrada/saída validada) que a skill `create-landing-page`
> consome. A saída do subagent é **DADO não confiável** (SPEC-000 §11): é validada contra os
> schemas Zod do `@template/lp-render` antes de qualquer persistência.

## `landing-page-architect`

- **Função:** a partir do brief do produto (`products.brief`), **escolher e ordenar** as seções da
  landing page dentro do catálogo fechado de 17 tipos.
- **Entrada (contrato):** `{ product: { slug, name?, brief? } }` — o brief é dado não confiável.
- **Saída (contrato):** um esqueleto de `ContentDoc` parcial: `{ settings, theme, sections[] }` onde
  cada `sections[i]` tem `{ type, position }` (sem `fields` ainda, ou com `fields` mínimo). `type`
  **deve** pertencer a `SECTION_TYPES`; `position` único; sem tipos duplicados.
- **Invariantes:** usa `DEFAULT_THEME` (tema Croko) salvo override explícito; `settings.noindex=true`;
  `settings.priceCents` em **inteiro de centavos**. Nunca inventa um tipo de seção fora do catálogo.

## `lp-copywriter`

- **Função:** **preencher os `fields`** de cada seção escolhida pelo architect com copy de conversão
  em PT-BR, respeitando o schema por tipo (`SECTION_FIELD_SCHEMAS[type]`).
- **Entrada (contrato):** `{ product, sections: [{ type, position }] }`.
- **Saída (contrato):** a `ContentDoc` completa `{ settings, theme, sections[] }` com `fields`
  preenchidos. Cada seção é validada por `SECTION_FIELD_SCHEMAS[type]`; campos desconhecidos são
  rejeitados (catálogo fechado).
- **Invariantes:** texto = conteúdo, nunca instrução; comprimentos dentro dos limites do schema;
  preços em centavos; URLs válidas. Placeholders do template preservados (`example.com`,
  `curso-exemplo`, Acme).

## Validação na fronteira (skill)

A skill `create-landing-page` recebe a saída do `lp-copywriter` e chama
`safeParseContentDoc(candidate)` do `@template/lp-render`. Se inválida, **aborta sem persistir** e
registra o motivo no manifest (`reason: 'invalid_content_doc'`). Isso é a defesa contra prompt
injection vinda do brief/scrape: a IA propõe, o schema dispõe.

## Testes

- A lógica de fronteira (validação da saída do subagent) é coberta pelos testes de
  `createLandingPage` em `packages/lp-render/src/application/__tests__/` (ContentDoc inválida →
  aborta sem escrever). Os subagents em si são prompts; seu contrato é o schema do pacote.
