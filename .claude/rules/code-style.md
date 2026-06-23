# Regra: Estilo de código e qualidade

Vale em todas as ondas (SPEC-000 §11).

## TypeScript
- **Estrito**: `strict`, `noUncheckedIndexedAccess` ligados (ver `tsconfig.json`).
- Sem `any` injustificado. Preferir tipos precisos, `unknown` + narrowing nas fronteiras.
- Dinheiro em **inteiro de centavos** (nunca float). IDs externos da Meta em `string`.

## Organização
- **Código em inglês** (identificadores, comentários técnicos). Docs do projeto em PT-BR.
- Separation of concerns; dependências apontam pra dentro:
  `presentation → application → domain`; `infrastructure` implementa interfaces do domínio.
- Boundaries entre bounded contexts via interface pública.
- Funções focadas e testáveis; documentar lógica complexa.

## Mudanças
- **Edits mínimos**: alterar o necessário, seguir os padrões existentes do arquivo.
- **Commits atômicos** (Conventional Commits): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`…
  Referenciar a onda/spec quando útil: `feat: wave 2 traffic skill [SPEC-000]`.

## Docs as Code
- Spec por feature **antes** do código (`docs/specs/`).
- ADR (Nygard) por decisão estrutural (`docs/adr/`).
- API-first: contratos antes do handler. Estrutura de docs em **Diátaxis**.

## Erros
```ts
try {
  // operação
} catch (error) {
  // log estruturado sem PII + contexto da operação
  throw new Error(`Failed to <operation>: ${(error as Error).message}`);
}
```
