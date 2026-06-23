# ADR 0017 — Pacote compartilhado `@template/lp-render`

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 8

## Contexto

Três consumidores precisam falar a **mesma linguagem de landing page**:

1. As **skills** do runner (`create-landing-page`, `publish-landing-page`) — montam e serializam a
   `ContentDoc`.
2. O **template** `landing-pages/_template` — renderiza as seções no build estático.
3. O **editor** do dashboard (Onda 9) — valida e edita campos por seção com os mesmos schemas.

Se cada um redefinisse os tipos/seções/validação, divergiriam: uma seção válida na skill poderia
quebrar no template ou escapar à validação do editor. Também há lógica de domínio comum à
apresentação da LP — montagem de URL de **checkout**, parâmetros de **affiliate**, propagação de
**UTM** e gestão de **consent** — que não pode ser duplicada nem viver em três lugares.

Restrições da SPEC-000: monorepo modular (§5), dependências apontando pra dentro, boundaries entre
contextos por interface pública (§5/§11), TS estrito.

## Decisão

Vamos extrair um pacote compartilhado **`packages/lp-render` (`@template/lp-render`)**, fonte única
de:

- **Tipos** `ContentDoc` / `Theme` / `Settings` e o catálogo das **17 seções** com seus **schemas
  Zod** (ADR 0013).
- O **serializer** `ContentDoc → { messages/pt.json, content-spec.json, theme.css }`, consumido pela
  skill de publish (rodado com `tsx` no runner).
- **Libs de domínio de apresentação:** `checkout`, `affiliate`, `utm`, `consent` (puras, testáveis).

Os três consumidores (skills, `_template`, editor) **importam deste pacote**; nenhum redefine tipo
de seção ou regra de validação. A persistência continua sendo no Supabase (ADR 0015); o pacote não
acessa banco nem rede — é domínio puro de render/serialização.

## Consequências

- **+** Fonte única dos tipos/seções/validação: o que é válido na skill é válido no template e no
  editor (sem divergência).
- **+** Libs de domínio (checkout/utm/affiliate/consent) puras e cobertas por **unit tests**
  (pirâmide da SPEC-000 §11 — `domain`/`application`).
- **+** Reaproveitamento entre runner e dashboard sem duplicação; boundary explícito via API pública
  do pacote.
- **+** O pacote não toca banco/rede → fácil de testar e raciocinar (separation of concerns).
- **−** Mais uma unidade de build/versionamento no monorepo (precisa entrar no pipeline de
  lint/typecheck/test).
- **−** Mudança no contrato de seção é breaking para os três consumidores ao mesmo tempo — exige
  coordenação (mitigado por versionar a seção em `landing_page_sections.version`).
