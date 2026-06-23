# Documentação — estrutura Diátaxis

> Docs as Code (SPEC-000 §11). Spec por feature **antes** do código; ADR por decisão estrutural.

## Mapa

- **`adr/`** — Architecture Decision Records (formato Nygard). Decisões estruturais. Stubs já
  criados; preenchidos onda a onda. Índice: [`adr/README.md`](./adr/README.md).
- **`specs/`** — specs por feature. Índice: [`specs/README.md`](./specs/README.md).
- **`how-to/`** — guias orientados a tarefa (ex.: `setup-do-zero.md`).
- **`tutorials/`** — passo a passo de aprendizado (ex.: deploy do runner Fly).
- **`reference/`** — referência técnica (ex.: `runner-reference.md`).
- **`explanation/`** — discussão/contexto de design.
- **`security/threats/`** — threat models STRIDE por superfície.
- **`templates/`** — `adr-template.md`, `spec-template.md`.
- **`sessions/`** — handoffs de sessão (`YYYY-MM/`).

## Convenção

Cada onda do [`../WAVES.md`](../WAVES.md) referencia suas specs/ADRs. Ao executar uma onda,
preencha os stubs correspondentes (status `draft`→`accepted`).
