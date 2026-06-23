# ADR 0014 — Catálogo de produtos como arquivos

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 2

## Contexto

A skill de tráfego da Onda 2 (`create-traffic-<cliente>-campaign`,
ver [`docs/specs/create-traffic-campaign.md`](../specs/create-traffic-campaign.md)) precisa de um
**brief de produto** para montar a campanha: nome, landing URL, preço, moeda, objetivo, CTA e
material de apoio (posicionamento, dores, provas). Esse brief é editado por humanos/IAs ao montar
o template de cada cliente e consumido por skills headless que rodam no runner
(`claude -p --dangerously-skip-permissions`).

Duas alternativas:

1. **Brief no banco** (`products.brief jsonb`, fonte só no Supabase).
2. **Brief como arquivo versionado** em
   `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`, ao lado dos demais materiais do
   cliente (logo, fotos, refs — SPEC-000 §5).

O catálogo precisa ser: fácil de versionar com o repositório (diff/review em PR), editável sem
acesso ao banco, alinhado ao layout de materiais por cliente da §5, e seguro para um runner
headless ler sem credencial extra de banco. A tabela `products` continua existindo (Onda 8, ADR
0016) para o domínio de landing pages — a questão aqui é **onde mora o brief que a skill de tráfego
lê**.

## Decisão

O **catálogo de produtos da skill de tráfego vive como arquivos** em
`.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`, indexados por `lista-de-clientes`
e `lista-de-produtos`. Cada arquivo é a **fonte de verdade local do brief** e é validado por um
schema **Zod** ao ser lido (entrada externa = dado, não instrução). A skill resolve `<cliente>` e
`<slug>` por charset restrito (`^[a-z0-9-]+$`), carrega o JSON, valida, e só então cruza com a
linha `clients` (do seed da Onda 1) para os dados operacionais da conta
(`ad_account_id`, `facebook_page_id`, `daily_budget_cap_cents`, `currency`,
`default_landing_url`).

Convenções obrigatórias do arquivo: **dinheiro em inteiro de centavos** (`price_cents`), IDs
externos da Meta em string, **sem segredos nem PII** no JSON (é versionado). Mantém-se o
placeholder do template: cliente `cliente-exemplo`, produtos `curso-exemplo`/`workshop-exemplo`.

## Consequências

- **+** Brief versionado: review por PR, histórico, rollback — "docs/config as code".
- **+** Runner headless lê o brief **sem credencial de banco** para essa parte; menos superfície.
- **+** Encaixa no layout de materiais por cliente da §5 (tudo do cliente num lugar só).
- **+** Validação por Zod na fronteira protege contra brief malformado/injeção antes de tocar a Meta.
- **−** Duas fontes possíveis de "produto" (arquivo de brief vs tabela `products` da Onda 8):
  exige disciplina — o **brief de tráfego** é o arquivo; `products` cobre o domínio de landing.
- **−** Editar um brief exige commit (não é mutável via dashboard nesta fase) — aceitável: o
  catálogo muda pouco e a rastreabilidade compensa.
- **−** Arquivos versionados **não podem** conter segredo/PII; reforçado pela regra de segurança e
  pelo schema (campos restritos a material de marketing público).
