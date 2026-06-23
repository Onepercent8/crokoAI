# ADR 0003 — Bucket público de ingest da Meta (`ad-ingest`)

- **Status:** accepted
- **Data:** 2026-06-22
- **Onda:** 1

## Contexto

Ao criar um criativo de imagem na Meta Marketing API, a imagem é referenciada **inline em
`link_data.picture`** por URL (SPEC-000 §10, gotchas da Meta). A Meta faz fetch dessa URL pelos
servidores dela no momento da criação do criativo — ou seja, a URL precisa ser **publicamente
acessível** (sem auth), senão o fetch falha e o criativo não é criado. Nossos buckets de criativos
(`creatives`, `nexus-review`) são privados por conterem artefatos internos.

## Decisão

Vamos manter um bucket de Storage **público** dedicado, `ad-ingest`, exclusivamente para servir as
imagens de criativo que a Meta precisa buscar. Os demais buckets seguem o princípio de menor
privilégio: `creatives` (privado), `nexus-review` (privado), `landing-assets` (público, assets de
LP servidos ao usuário final).

## Consequências

- **+** A Meta consegue buscar a imagem; criação de criativo funciona sem URLs assinadas frágeis.
- **+** Superfície pública isolada num único bucket (`ad-ingest`), separada dos artefatos privados.
- **−** Conteúdo de `ad-ingest` é publicamente legível por quem souber a URL — portanto guardar ali
  **apenas** imagens destinadas a anúncios (nunca PII ou material sensível); nomes de objeto com
  componente aleatório para não serem adivinháveis.
