# ADR 0015 — Conteúdo da landing page editável no Supabase (não em arquivos)

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 8

## Contexto

Uma LP precisa ser **gerada por IA**, **editada pelo operador** (Onda 9) e **republicada** quantas
vezes for preciso. Onde mora a fonte da verdade do conteúdo?

- Se o conteúdo morasse em **arquivos no repo** (ex.: `messages/pt.json`, `content-spec.json`
  versionados por LP), cada edição exigiria commit/PR e o editor do dashboard não teria como
  persistir mudança sem mexer no git — incompatível com edição em tempo real pelo operador e com a
  comunicação **só via banco** entre planos (SPEC-000 §3).
- O dashboard (Vercel) e o runner (Fly) não compartilham filesystem; o **único canal** entre eles é
  o Supabase. Logo, o conteúdo editável tem de viver no banco para o runner enxergar o que o
  dashboard escreveu.
- A geração nasce como **rascunho** (`noindex` em preview) e só vira artefato estático no publish.

Alternativas: conteúdo em arquivos do repo (acima); CMS de terceiros (acoplamento, outra fronteira
externa, foge do "Supabase como única fonte da verdade").

## Decisão

Vamos manter o conteúdo da LP **no Supabase**, não em arquivos. A `ContentDoc`
(`{ settings, theme, sections[] }`) é persistida como:

- `landing_pages.settings` (jsonb), `landing_pages.theme` (jsonb) — config e tema da página;
- `landing_page_sections` — **uma linha por seção** (`landing_page_id`+`type` único, `position`,
  `enabled`, `fields jsonb`, `version`).

O ciclo de vida usa `landing_pages.draft_status` (`empty → generating → ready → editing →
publishing`) e `status` (`draft → building → deployed → failed`). A skill
`create-landing-page-<cliente>` **escreve o rascunho** (settings/theme/sections) e enfileira um job
`landing_publish`. A skill `publish-landing-page-<cliente>` **lê do banco**, serializa via
`@template/lp-render` (ADR 0017) para `messages/pt.json` + `content-spec.json` + `theme.css`, builda
o `_template` e faz deploy (ADR 0012). Os arquivos serializados são **artefatos efêmeros de build**,
nunca a fonte da verdade. Ao publicar com sucesso, grava-se `published_snapshot` (jsonb) para
auditoria/rollback.

A persistência segue os contratos da SPEC-000 §10: no runner headless é via **REST +
`SUPABASE_SECRET_KEY`** (nunca o MCP do Supabase); RLS deny-by-default (só `service_role`).

## Consequências

- **+** Edição em tempo real pelo operador (Onda 9) sem git: o editor escreve em
  `landing_page_sections`/`landing_pages` e o runner enxerga via banco.
- **+** Alinha com o decoplamento por banco (SPEC-000 §3): dashboard escreve, runner lê.
- **+** `published_snapshot` dá rastreabilidade e base para rollback/diff entre publicações.
- **+** Conteúdo validável por seção (Zod) na fronteira de escrita.
- **−** Os arquivos serializados (`pt.json`/`content-spec.json`/`theme.css`) são derivados — não
  podem ser editados à mão como fonte (seriam sobrescritos no próximo publish).
- **−** Uma seção mal-formada no banco só falha no publish se a validação de fronteira não a barrar
  antes; por isso a validação Zod na escrita é obrigatória (mitiga "garbage in").
