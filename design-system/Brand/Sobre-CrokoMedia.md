# ESTRATÉGIA DE NEGÓCIO — CrokoMedia

> Documento central da agência (antiga Pazos Media → **CrokoMedia**).
> Visão geral + o detalhe que NÃO está no site. Inclui canais, oportunidade de produto e amarração com a meta de imigração.

---

## O QUE FAZEMOS
Agência de **gestão de tráfego pago** — mas entregamos além da gestão: **visão, estratégia, apoio comercial e dicas de operação**. Posicionamento real: parceiro estratégico de crescimento, não "gestor de tráfego" de execução.

---

## QUEM ATENDEMOS (segmentos provados)

**1. Estética / clínicas premium — Brasil** ← *segmento quente agora*
Âncora: rede **Face Doctor** (rede premium de rejuvenescimento facial/corporal, 140+ unidades em 80%+ do Brasil). As indicações chegam via franqueados da rede. Hoje entregamos **apenas gestão de tráfego** a esses clientes — abaixo do que sabemos entregar (ver gap).
Sites: facedoctor.com.br

**2. E-commerce de beleza importada (EUA → Brasil)**
Marcas que brasileiras conhecem mas que não vendem no Brasil. Case de destaque: **Lauren Imports (46x ROI)**. Também AEA Imports, Loja Moeuquero, DS Beauty.
Este é exatamente o ICP do scraper de prospecção (Nuvemshop beleza, semeado por Meta Ad Library).
Sites: laurenimports.com.br · aeaimports.com.br · lojamoeuquero.com · dsbeauty.com.br

**3. Construção / outdoor living — EUA (Flórida)**
Hardscaping/pavers, áreas externas, fechamento de varandas e telas (patio screen enclosures, Orlando). Operação e receita em solo americano.
Sites: directpavers.com · sunshinestateoutdoors.com · patioscreenenclosuresorlando.com

**4. Beleza / serviço local — Brasil**
Salão. Sites: instagram.com/youescovainteligente

---

## QUEM NÃO ATENDEMOS `[proposta — confirme]`
> Definir isso é o antídoto da dispersão. Sugestão a partir do que já dá certo:
- Fora dos nichos provados (estética/beleza, e-com de importados, construção/outdoor EUA).
- Quem quer só execução de tráfego, sem parceria estratégica.
- Abaixo de um piso de investimento em mídia: >> (definir valor).

---

## PROPOSTA DE VALOR
Entregamos crescimento, não relatório de mídia. Visão estratégica + estratégia de funil + apoio comercial, operando como sócios do resultado do cliente. Prova social: 46x ROI (Lauren Imports) e crescimento por indicação dentro de uma rede premium (Face Doctor) — quem indica é par do cliente, não vendedor.

---

## MOTOR DE CRESCIMENTO (canais)
- **Inbound quente:** indicação de franqueados Face Doctor. Canal escalável — são 140+ unidades com a mesma dor e o mesmo perfil. Virar o parceiro de fato da rede transforma cada novo franqueado em pipeline.
- **Outbound:** scraper de e-coms de beleza Nuvemshop (perfil Lauren Imports), semeado pela Meta Ad Library → alimenta o segmento 2.

---

## OPORTUNIDADE DE PRODUTO — automação de WhatsApp `[detalhe fora do site]`
O mesmo cliente de estética está pedindo **automação de WhatsApp com agentes + WhatsApp oficial (API/Cloud da plataforma)**. Ainda **não temos esse serviço implementado**.

Por que é a próxima jogada óbvia:
- **Segunda linha de receita recorrente** sobre a base que já temos — sobe LTV e retenção sem custo de aquisição novo.
- **Cunha na rede Face Doctor:** produto que aprofunda a relação e dificulta a troca de agência.
- **Construível em casa** com o stack atual (Claude API + N8N) — viés por API crua já é seu.
- Sequência sugerida: implementar para 1–2 clínicas Face Doctor como piloto → padronizar como produto → ofertar à rede.

---

## CONTEXTO QUE NÃO ESTÁ NO SITE
- **Rebrand:** Pazos Media → CrokoMedia. Motivo/posicionamento por trás: >>
- **Gap posicionamento × entrega:** vendemos "mais que gestão", mas no segmento estética entregamos hoje só tráfego. Fechar esse gap (estratégia + WhatsApp) é o caminho de upsell.
- **Modelo de cobrança (gargalo ativo):** hoje cobramos apenas um fee mensal fixo baixo (~R$2–3,5k) por todo o resultado e a entrega. Sem upside quando a conta cresce. Ver seção **Modelo Comercial**.
- **O que tentamos e não funcionou (e por quê):** >> (Ali insiste neste — é o que dá fundamento às decisões)
- **Decisões estruturais e o porquê real:** >>

---

## MODELO COMERCIAL (gargalo atual → modelo-alvo)

**Estado atual (competência 05/2026):** ~9 contas, ticket médio ~R$2.500, MRR ~R$23–26k. Fee mensal fixo baixo, igual para quem entrega 2x e para quem entrega 46x.

| Cliente | Fee atual /mês | Segmento |
|---|---|---|
| Lauren Imports | R$3.500 | E-com (46x ROI) |
| A&A Imports BR | R$3.000 | E-com |
| Loja Mô Eu Quero | R$2.500 | E-com |
| DS Beauty | R$2.497 | E-com |
| You Escova Inteligente | R$2.500 | Salão |
| Face Doctor Santo Agostinho | R$2.500 | Estética |
| Face Doctor Barbacena | R$2.500 | Estética |
| Central Florida Outdoor (USD/Stripe) | R$2.282 | Construção EUA |
| Sunshine State Outdoor | R$2.000 | Construção EUA |

**Problema:** fee fixo não captura upside. Quem multiplica o cliente recebe o mesmo de quem o mantém. Lauren a 46x pagando R$3.500 é o caso-síntese.

**Modelo-alvo — fee base + variável, por segmento:**

- **E-commerce** (atribuição limpa): fee base + **% sobre faturamento atribuído** (rev-share) *ou* **% da verba de mídia gerida**. Maior upside aqui. Rev-share alinha com o resultado; % de verba escala com a conta e é mais simples.
- **Clínicas estética (Face Doctor):** fee base + **valor por agendamento qualificado (CPA)** *ou* fee + % verba + bônus por meta. Somar o produto de WhatsApp como **linha recorrente separada** (setup + mensalidade), precificada cheia.
- **Construção EUA (USD):** fee base em USD (maior que o BR) + **% de verba** *ou* por lead qualificado.

> Faixas (% de verba, % de rev-share, CPA) são estruturas comuns de mercado — definir os números a partir das duas variáveis abaixo. Não é recomendação financeira fechada.

**Transição sem queimar a base:**
1. Clientes novos e indicações Face Doctor entram já no modelo novo.
2. Atuais repreços na renovação, liderando com **relatório de ROI** (o valor entregue justifica o número novo).
3. Começar pela **Lauren Imports** — o 46x faz o argumento sozinho.
4. Subir também o **piso do fee base** — R$2–2,5k está abaixo de gestão estratégica de tráfego.

**Inputs para fechar os números:**
- Verba de mídia gerida por conta (define % de verba e o tamanho real de cada conta): >>
- Margem-alvo da agência por conta: >>

---

## AMARRAÇÃO COM A META DE IMIGRAÇÃO
> **Situação (jun/2026):** sem entidade nos EUA hoje. Plano: tirar visto de turista no próximo mês (jul), visitar os EUA e analisar possibilidades de abrir empresa lá. A perna de Orlando (jul, 2ª temporada de viagens) é a janela natural para essa prospecção e para reunir com advogado de imigração.

> **Ativo a favor:** já há receita em solo americano (construção/outdoor pagando via Stripe) + o negócio de redirecionamento high ticket. Uma entidade US poderia consolidar essa operação e dar substância ao caminho do green card.

**Caminhos (confirmar com advogado):**
- **L-1A "new office" → EB-1C:** como já existe a empresa no Brasil (CrokoMedia), abrir uma afiliada/subsidiária nos EUA permite transferir você como executiva mesmo com a empresa US recém-criada. Após ~1 ano operando + critérios atendidos, abre o **EB-1C (green card)**. É o caminho que melhor aproveita o que vocês já têm: empresa BR + receita US. A viagem de jul serve justamente para estruturar isso.
- **O-1A → EB-1A / EB-2 NIW (via talento):** não dependem de entidade. Sustentadas pelo seu track record (46x ROI, crescimento da agência, marca pessoal, INPI). Autopetição, sem grande capital. Podem rodar em paralelo ao L-1.

**Cuidado prático:** o visto de turista (B-1/B-2) permite **visitar, reunir, prospectar e negociar** — não permite trabalhar/operar a empresa nem demonstrar intenção imigrante. Formar a entidade pode ser ato admissível, mas operá-la não. Confirmar o que pode e o timing certo com advogado **antes** da viagem para não comprometer pedidos futuros. `[não é aconselhamento jurídico — confirmar com advogado de imigração]`

**Perguntas para o advogado (viagem de jul):**
- L-1A new office vs. via talento (O-1A/EB-1A) — qual encaixa melhor no perfil e no prazo de vocês?
- Estado e estrutura para a entidade US, consolidando construção + redirecionamento?
- O que é permitido fazer na viagem com visto de turista sem comprometer o processo?

---

## STACK
Claude API, Claude Code, N8N, Lovable, Supabase, Vercel, Next.js, Remotion, Puppeteer. (Relevante: o produto de WhatsApp é construível com esse stack, sem wrapper.)

---

## ECOSSISTEMA RELACIONADO (fora da agência)
- **Convertte.ai** — domínio registrado; produto/sistema/app/serviço ainda a definir (a definição virá via agente).
- **OnePercent®** — marca registrada; produto/sistema/app/serviço ainda a definir (idem).
- **MadameCash** — projeto em desenvolvimento no Claude Code, uso pessoal por enquanto.
- **Outros builds em exploração** — Kindle Narrador, pipeline UGC TikTok Shop. `[de contexto anterior — confirme status]`

Todos mantidos como ativos separados da operação de serviço da CrokoMedia.
