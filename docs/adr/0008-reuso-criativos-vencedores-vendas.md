# ADR 0008 — Reuso de criativos vencedores na campanha de vendas

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 5

## Contexto

A campanha de vendas (kind `create_sales`, `OUTCOME_SALES`, otimizada para o evento **PURCHASE** do
pixel) é a etapa em que o sistema busca **conversão paga**, depois de a fase de tráfego (Onda 2) ter
gerado criativos e de a analytics (Onda 4) ter medido o funil de 7 etapas — incluindo **compras por
entidade**.

Forças em jogo (SPEC-000 §8 Onda 5/§10):

- Há **sinal de performance** disponível: os `funnel_events`/`metric_snapshots` da Onda 4 dizem
  quais criativos converteram (compras + valor). Ignorar esse sinal e gerar criativos novos para a
  campanha de vendas desperdiça aprendizado e dinheiro testando do zero.
- Gerar criativo novo custa (imagem `gpt-image`, prompts, tempo) e **reinicia a fase de aprendizado**
  da Meta. Reusar um criativo que já tem histórico de conversão é mais barato e converge mais rápido.
- **Gotcha da Meta v25 (crítico):** em `OUTCOME_SALES` o campo `destination_type` **deve ser
  omitido** — enviá-lo quebra a criação do ad set. É um erro fácil de cometer por herança do molde de
  tráfego (onde `destination_type='WEBSITE'` é obrigatório).
- Risco de **gasto às cegas:** reusar um criativo "vencedor" que na verdade nunca converteu (0
  compras) é gastar sem base.

Alternativas consideradas:

- **Gerar criativos novos para vendas** (como na Onda 2): descartado — joga fora o sinal de compras
  e reinicia o aprendizado; mais caro e mais lento para converter.
- **Reusar todos os criativos da conta**: dilui orçamento em criativos ruins; sem foco no que
  converte.
- **Manter `destination_type` "por consistência" com tráfego**: quebra a Meta v25 — inaceitável.

## Decisão

A campanha de vendas **reusa os top-N criativos vencedores por compras**, selecionados por
`selectTopCreatives` (domínio puro): ranqueia os candidatos por `purchases` (desc), desempata por
`purchase_value_cents` e por `meta_creative_id` (saída **determinística**), **exclui quem tem 0
compras** e corta em `top_n` (default 3). Se **não houver vencedor**, a skill **aborta** (não cria
campanha vazia nem gasta às cegas).

A hierarquia nasce **PAUSED** (gasto só depois, pela skill de ativação — ADR 0007), com
`objective='OUTCOME_SALES'`, ad set otimizado para `custom_event_type='PURCHASE'` no `pixel_id` do
cliente e `optimization_goal='OFFSITE_CONVERSIONS'`. O ad set reusa os `meta_creative_id` vencedores
em novos ads — **não cria criativo novo**.

**`destination_type` é omitido por construção:** a interface `MetaSalesAdSetSpec` **não possui** esse
campo, e a linha persistida em `ad_sets` também o omite (`buildAdSetRow` só o inclui quando presente).
Assim o gotcha v25 é impossível de violar por acidente — não é uma checagem em runtime que se pode
esquecer, é ausência estrutural no tipo. Orçamento é clampado ao teto do cliente (clamp, não aborta).
Cada mutação grava 1 `operation_logs` (`action='create'`, append-only); persistência via REST.

## Consequências

- **+** A campanha de vendas começa concentrada nos criativos que **comprovadamente convertem**,
  aproveitando o aprendizado da Meta e o sinal de compras da Onda 4.
- **+** `destination_type` é **estruturalmente** impossível de enviar em `OUTCOME_SALES` (ausente do
  tipo), eliminando a classe de bug do gotcha v25 sem depender de lembrar de um `if`.
- **+** Seleção determinística (desempate estável) torna o resultado reprodutível e testável offline.
- **+** Nascer PAUSED + reuso de criativo (sem geração) reduz custo e superfície; o gasto só começa
  na ativação fail-closed (ADR 0007).
- **−** Depende de a Onda 4 ter rodado e gravado compras por criativo; **sem histórico de compras**,
  a skill aborta (intencional — sem gasto às cegas), exigindo primeiro acumular conversão na fase de
  tráfego/aprendizado.
- **−** Concentrar em poucos vencedores pode **sub-explorar** criativos novos; mitigável aumentando
  `top_n` ou rodando tráfego em paralelo para gerar novos candidatos.
- **−** A definição de "compra" depende da fidelidade do pixel/CAPI; atribuição imperfeita enviesa a
  seleção (aceitável; é o melhor sinal disponível e melhora com o tracking da Onda 10).
