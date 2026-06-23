# ADR 0016 — Tabela `products` como âncora da landing page

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 8

## Contexto

Uma LP existe para **vender um produto** (ex.: `curso-exemplo`, `workshop-exemplo`). O brief do
produto (proposta de valor, público, oferta, preço, prova social) é o insumo da geração: os
subagents `landing-page-architect` e `lp-copywriter` precisam de uma fonte estruturada para montar
a `ContentDoc`. Há duas naturezas de informação do produto:

- **Material de origem** (briefs, refs, fotos) que o builder coloca em
  `materiais-das-empresas/<cliente>/produtos/<slug>.json` (catálogo como arquivos —
  [ADR 0014](0014-catalogo-produtos-arquivos.md)).
- **Estado relacional** que o sistema precisa consultar/relacionar no banco: a que cliente o produto
  pertence, qual o subdomínio default, qual o status, e qual o brief efetivo usado na geração.

Como o conteúdo da LP vive no Supabase (ADR 0015) e a LP precisa referenciar seu produto com
integridade (FK), o produto precisa existir **também como linha no banco**, não só como arquivo.

## Decisão

Vamos modelar o produto como a tabela **`products`** (já definida na SPEC-000 §6):
`client_id`+`slug` único, `brief_path` (ponteiro para o arquivo de origem em
`materiais-das-empresas/`), `brief jsonb` (cópia estruturada/normalizada do brief usado na
geração), `default_subdomain`, `status`. A `landing_pages` referencia `products` por FK
**`ON DELETE RESTRICT`** (não apagar um produto ainda referenciado por uma LP — SPEC-000 §6 / spec
de persistência).

Divisão de responsabilidade: o **arquivo** (`materiais-das-empresas/.../<slug>.json`, ADR 0014) é a
origem editorial humana; a **linha em `products`** é a projeção relacional consultável pelo runner e
pelo dashboard, com `brief jsonb` guardando o payload usado. Assim mantemos o catálogo-como-arquivo
(ADR 0014) e a integridade relacional ao mesmo tempo.

## Consequências

- **+** Integridade referencial: LP sempre aponta para um produto existente (FK RESTRICT).
- **+** O runner e o dashboard leem o brief do banco (canal único, SPEC-000 §3) sem depender do
  filesystem de origem.
- **+** `default_subdomain` no produto dá um default sensato ao criar a LP.
- **+** Coexiste com o catálogo-como-arquivo (ADR 0014): arquivo = origem, linha = projeção.
- **−** Duplicação de verdade entre `brief_path` (arquivo) e `brief jsonb` (linha): precisa de uma
  etapa de sincronização/ingest clara (o arquivo é a origem; a linha é gravada a partir dele).
- **−** RESTRICT exige despublicar/remover a LP antes de remover o produto (deliberado, evita órfãos).
