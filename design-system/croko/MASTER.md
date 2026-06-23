# Croko — Design System (MASTER)

> Fonte da verdade da identidade digital da Croko. Documenta o que **de fato**
> foi construído nas landing pages, não uma recomendação genérica.
> A recomendação original da skill ui-ux-pro-max fica em `skill-recommendation.md`
> apenas como referência.
>
> Tokens prontos para reuso: [`tokens.css`](./tokens.css).
> Overrides por página: pasta [`pages/`](./pages/) — se existir um arquivo para a
> página, ele sobrepõe este MASTER; senão, vale este documento.

---

## 1. Marca

**Croko™** (antiga Pazos Media). Agência de gestão de tráfego pago posicionada
como **parceira estratégica de crescimento** — não fornecedora de execução.

- **Logo:** marca do crocodilo em "C" + wordmark "Croko™".
- **Aplicação em fundo escuro:** usar a marca verde (`croko-mark`) com
  `mix-blend-mode: lighten` — o fundo escuro do arquivo some e sobra só a forma.
  Nunca colocar a logo completa em JPEG sobre fundo de cor diferente (gera
  retângulo cinza). Em UI, o lockup é **ícone (imagem) + wordmark em texto**.

---

## 2. Princípios de design

1. **Premium e escuro.** Base `#1c1c1c`, tipografia grande, muito respiro.
   Referência de qualidade: padrão awwwards.
2. **Não pode parecer feito por IA.** Layout assimétrico, grão sutil sobre tudo,
   detalhes tipográficos cuidados, cópia concreta com fatos reais. Evitar
   gradientes-em-tudo, três cards idênticos com ícone, cópia genérica.
3. **Movimento com propósito.** Animação reforça a narrativa de "crescimento em
   movimento"; nunca atrapalha leitura nem performance. Sempre respeitar
   `prefers-reduced-motion`.
4. **Prova, não promessa.** Números e fatos no centro (46x, 140+, 2 países).

---

## 3. Cores

| Token | Hex | Uso |
|---|---|---|
| `--croko-teal` | `#0a6e75` | Primária. Acentos, glows, detalhes, índices. |
| `--croko-green` | `#57cc99` | Ação. CTAs, números, destaques de texto, ícones de sucesso. |
| `--croko-green-soft` | `#c1e1c2` | Hover de CTA, brilhos suaves. |
| `--croko-paper` | `#e1e1e1` | Texto principal sobre fundo escuro. |
| `--croko-ink` | `#1c1c1c` | Fundo base. |
| `--croko-ink-2` | `#151515` | Faixas/seções alternadas. |
| `--croko-ink-3` | `#202020` | Cards elevados. |
| `--croko-muted` | `#9a9c99` | Texto secundário. |
| `--croko-muted-2` | `#6a6c69` | Texto terciário, labels discretos. |

**Contraste (WCAG):** texto principal `paper` sobre `ink` ≈ 12:1 (AAA). `muted`
sobre `ink` ≈ 5.8:1 (AA para corpo). **Não** usar `muted-2` para blocos longos de
texto — só labels curtos. Verde/teal nunca como único indicador de estado
(acompanhar com ícone ou texto).

**Destaque de texto:** usar **cor sólida** (`--croko-green`). Degradê em texto foi
testado e descartado — não usar `background-clip: text` nos títulos.

---

## 4. Tipografia

| Papel | Fonte | Observações |
|---|---|---|
| Display / títulos | **Clash Display** (600/500) | Personalidade forte, awwwards. Tracking negativo (`-0.03em`), line-height ~0.95. |
| Corpo | **Satoshi** (400/500/700) | Altamente legível. Line-height 1.5–1.6. |
| Labels / kickers | Satoshi 500 | Caixa-alta, tracking `0.22em`. |

- **Fonte (CDN):** Fontshare —
  `https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&f[]=satoshi@400,500,700&display=swap`
- **Fallback / alternativa Google Fonts:** Space Grotesk (display) + Inter (corpo)
  — foi a base da V1 e segue válida como variação mais sóbria.
- Corpo nunca abaixo de **16px** no mobile. Largura de linha 60–75 caracteres.

---

## 5. Espaçamento, layout e raios

- **Container:** `--croko-maxw: 1320px`, centralizado.
- **Respiro lateral:** `--croko-pad: clamp(1.25rem, 5vw, 6rem)`.
- **Respiro vertical de seção:** `--croko-sec-y: clamp(6rem, 13vw, 11rem)`.
- **Raios:** cards `18px`, botões/chips `pill (100px)`, pequenos `10px`.
- **Breakpoints:** 375 · 640 · 1024 · 1440. Nav vira compacta ≤1024px.

---

## 6. Movimento

- **Easing padrão:** `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Micro-interações (hover):** 150–300ms. **Reveals de scroll:** ~1s, `translateY(34px)` + fade.
- **Transformar só `transform`/`opacity`** (nunca width/height) por performance.
- Padrões usados: cursor custom (dot + ring com inércia), barra de progresso de
  scroll, parallax suave do mark no hero, reveal por máscara no título, marquee
  infinito, scroll-snap horizontal nos serviços, botões magnéticos, contadores.
- **Acessibilidade:** tudo dentro de `@media (prefers-reduced-motion: reduce)`
  desliga animações; cursor custom e parallax só em `(hover:hover) and (pointer:fine)`.

---

## 7. Componentes

- **Nav:** fixa, transparente no topo → `is-scrolled` adiciona blur + borda inferior.
  Lockup à esquerda, links centrais com underline animado, CTA sólido à direita.
- **Botões:** `--solid` (verde, texto ink; hover → green-soft) e `--ghost`
  (borda; hover → verde). Pill. Ícone de seta opcional. Variante `--lg`.
- **Cards:** borda `--croko-line`, raio 18px, hover eleva `translateY(-6px)` e
  borda esverdeada. Card de destaque usa glow radial teal.
- **Marquee:** faixa com `animation: scroll-x` linear infinita; conteúdo
  duplicado; separadores em ponto teal.
- **Bloco antes/depois:** coluna "antes" cinza com ícone X, coluna "depois" com
  glow teal e ícone de check; seta conectando (horizontal no desktop, vertical no mobile).
- **Ícones:** **somente SVG inline** (stroke `currentColor`, viewBox 24×24). **Nunca emojis.**

---

## 8. Voz e cópia (regras de conteúdo)

Restrições obrigatórias, validadas com a cliente:

- **Não citar nomes de clientes.** Apenas **resultado + nicho**
  (ex.: "46x — e-commerce de beleza importada", "rede premium de estética").
- **Não usar o termo "sócio/sócia".** Preferir: "parceira de crescimento",
  "trabalha dentro da operação do cliente", "cada real de verba ligado a uma meta".
- **Não citar a stack/ferramentas** (nada de nomes de produtos de software).
  Falar em capacidades: "automação", "inteligência artificial aplicada",
  "dados & atribuição", "integrações sob medida", "produto próprio".
- **Sem emojis** em nenhum lugar.
- Tom: confiante, concreto, direto. Frases curtas. Verbo de resultado.

---

## 9. Conteúdo de referência (fatos aprovados para uso público)

- **46x** — ROI máximo entregue (e-commerce de beleza importada).
- **140+** — unidades em rede premium de estética, atendidas por indicação.
- **2 países** — operação Brasil & Estados Unidos.
- **4 segmentos provados:** estética/clínicas premium (BR); e-commerce de beleza
  importada; construção & outdoor (EUA/Flórida); beleza & serviço local.
- **Serviços:** gestão de tráfego pago; estratégia & funil; automação de WhatsApp
  com IA (sobre API oficial); apoio comercial & operação.

> Não usar publicamente: nomes de contas, fees, MRR, dados comerciais internos.

---

## 10. Onde isto vive (implementações)

- `site/` — **V1**, editorial/sóbria (Space Grotesk + Inter). HTML/CSS/JS, `index.html` autocontido.
- `site-v2/` — **V2**, motion-driven (Clash Display + Satoshi), construída a partir deste sistema.

Ambas usam a paleta e as regras de cópia deste documento. Para uma nova página,
crie `pages/<nome>.md` documentando apenas o que diverge deste MASTER.
