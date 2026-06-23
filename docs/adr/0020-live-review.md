# ADR 0020 — Live review (revisão visual da landing page)

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 9

## Contexto

Quando o Nexus acompanha a publicação de uma landing page (modo autônomo, [ADR 0019](0019-modo-autonomo-nexus.md)),
o operador quer mais do que "publicado": quer uma **opinião sobre como a página ficou**. Para isso o
sistema precisa capturar um frame visual da página recém-publicada (preview `*.example.com`) e
analisá-lo, gerando uma narração do tipo `opinion` e, opcionalmente, um email com o print.

A força crítica aqui é **segurança da captura**: tirar screenshot de uma URL é uma superfície
clássica de **SSRF** — uma URL controlada por dado (vinda de `landing_pages.fqdn` ou de args)
poderia apontar para `localhost`, metadata da cloud (`169.254.169.254`), IPs privados ou um domínio
arbitrário, vazando rede interna. A captura roda no **runner** (que tem credenciais), então o alvo
precisa ser fortemente restrito.

Alternativas consideradas: (a) screenshot no browser do operador — descartada porque o frame
publicado precisa ser visto pelo runner para gerar a opinião server-side e anexar ao email, e o
browser não deve carregar a lógica de review; (b) serviço de screenshot de terceiros — adiciona
segredo e exfiltra a URL/preview para fora; descartada.

## Decisão

Vamos implementar o **live review** como um par captura→análise no runner, com **SSRF-guard por
allowlist de sufixo de domínio**.

- **`scripts/screenshot-page.cjs`** (Playwright headless) captura o frame. Antes de navegar, valida
  a URL: protocolo `https`, host casando o sufixo **`*.example.com`** (placeholder do template),
  rejeitando IPs literais, `localhost` e qualquer host fora da allowlist. O print vai para o bucket
  **privado** `nexus-review` (Storage Supabase).
- **`lib/nexus/review-frame`** encapsula a captura + upload do frame; **`lib/nexus/live-review`**
  pega o frame, pede a opinião ao modelo de review (`NEXUS_REVIEW_MODEL`) e produz a narração
  `kind=opinion` + `image_path` apontando para o objeto em `nexus-review`.
- **`scripts/send-email.cjs`** (Resend) envia o resumo+print de forma **best-effort**: falha vira
  log, nunca derruba a fase `notifying` do watch (ver ADR 0019).
- O texto/URL da página são **dados não confiáveis**: validados por schema antes de uso e o conteúdo
  da página (scrape/screenshot) é tratado como entrada, não instrução (proteção contra prompt
  injection visual).

## Consequências

- **+** SSRF-guard por allowlist de sufixo bloqueia a classe inteira de alvos internos com uma regra
  simples e auditável; o print fica em bucket privado (sem exposição pública).
- **+** Review server-side mantém lógica e segredos fora do browser e permite anexar o print ao
  email do modo autônomo.
- **+** Reuso do mesmo provedor de Storage (Supabase) e do mesmo modelo fail-safe de notificação.
- **−** A allowlist `*.example.com` precisa ser trocada junto com o domínio real ao "tornar o
  template seu" — se esquecida, o review para de funcionar (falha segura: bloqueia em vez de vazar).
- **−** Playwright no runner aumenta o tamanho da imagem Docker e o tempo de tick quando há review.
- **−** A opinião depende de uma chamada de LLM com visão — custo e latência por publicação revisada;
  mitigado por ocorrer só na fase `reviewing`, uma vez por publish.
