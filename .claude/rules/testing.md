# Regra: Testes

Vale em todas as ondas (SPEC-000 §11).

## Pirâmide
- **Muito** unit · **médio** integração · **pouco** e2e.
- Unit obrigatório em `domain/` e `application/` (lógica pura, sem I/O).
- Integração no que tem I/O (DB, REST, MCP, storage).
- e2e seletivo nos fluxos críticos (login, criar campanha, publicar LP).

## Disciplina
- **Bug fix começa por um teste que reproduz** o bug (red → green).
- Testar edge cases e cenários de erro, não só o caminho feliz.
- Runner de teste: **Vitest** (`npm test` → `vitest run`). Arquivos `*.test.ts` / `*.spec.ts`.
- Cobertura mínima em `domain/`/`application/` (configurada em `vitest.config.ts`).

## Gate
- `npm run lint && npm run typecheck && npm test` verdes antes de marcar uma onda como aceita.
- Na Onda 0 ainda não há testes — `passWithNoTests` mantém o gate verde até a primeira suíte.
