# ADR 0013 — Design system da landing page (Theme + 17 seções)

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 8

## Contexto

As LPs são geradas e editadas por IAs (subagents `landing-page-architect` + `lp-copywriter`) e
depois editadas pelo operador (Onda 9). Para que tanto a IA quanto o editor produzam páginas
consistentes e de alta conversão, sem reinventar layout a cada página, é preciso um **vocabulário
fechado** de blocos de conteúdo e um **sistema de tema** estável. Forças:

- A IA precisa de um conjunto **enumerável e validável** de seções (não pode emitir HTML livre, que
  é inseguro e impossível de validar/editar por campo).
- O conteúdo deve ser **separado da apresentação**: a copy (texto/imagens) vive em campos; a
  identidade visual (cores, fontes, raio, sombra) vive num `Theme`.
- O template `_template` consome o resultado serializado; o editor (Onda 9) edita campo a campo
  por seção. Ambos precisam dos **mesmos tipos** (vêm do pacote `@template/lp-render`, ADR 0017).

Alternativas consideradas: HTML/JSX livre gerado pela IA (inseguro, não validável, não editável);
um page-builder de terceiros (acoplamento e fuga do modelo "conteúdo no Supabase").

## Decisão

Vamos definir um **design system fechado** no pacote `@template/lp-render`:

- **17 tipos de seção** (catálogo enumerável; ex.: hero, benefits, features, social-proof,
  testimonials, pricing, faq, cta, footer, …). Cada seção tem um **schema Zod** dos seus `fields` e
  um componente de render correspondente no `_template`.
- Um **`Theme`** tipado (paleta, tipografia/par de fontes, raio, sombra, espaçamento) serializado
  para `theme.css` (custom properties), aplicado por todas as seções.
- **`Settings`** da página (idioma `pt`, `noindex`, título/meta, `checkout_url`, etc.).

A IA e o editor só podem produzir/alterar seções **dentro deste catálogo** e campos **dentro dos
schemas Zod** — qualquer entrada fora do schema é rejeitada na fronteira (SPEC-000 §11). O
placeholder de marca do template é **Acme / example.com**; nenhum design-system de cliente real é
embutido nesta fase.

## Consequências

- **+** A IA produz páginas válidas por construção (catálogo fechado + Zod); nada de HTML arbitrário.
- **+** Conteúdo separado de apresentação: trocar o `Theme` re-tematiza todas as seções de uma vez.
- **+** O editor da Onda 9 edita por campo com validação reutilizando os mesmos schemas Zod.
- **+** Consistência visual e de conversão entre páginas (vocabulário comum de blocos).
- **−** Expressividade limitada ao catálogo: um layout fora das 17 seções exige adicionar um tipo
  novo (schema + componente + serializer) — mudança deliberada, não ad-hoc.
- **−** Acoplamento entre o catálogo de seções (lp-render) e os componentes do `_template`: os dois
  precisam evoluir juntos (mitigado por versionamento de seção em `landing_page_sections.version`).
