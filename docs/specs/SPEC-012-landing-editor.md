# SPEC-012 — Editor de landing page no dashboard

- **Status:** accepted (offline; e2e pendente de credenciais)
- **Onda:** 9
- **ADRs relacionados:** [0015](../adr/0015-lp-editavel-no-supabase.md) ·
  [0017](../adr/0017-pacote-lp-render.md) · [0009](../adr/0009-fila-agent-jobs.md) ·
  [0005](../adr/0005-dashboard-vercel.md) · [0006](../adr/0006-auth-do-dashboard.md)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 Onda 9 ·
  §6 (landing) · §10 · §11

## Objetivo

Permitir que o operador edite uma landing page **pelo dashboard**, campo a campo, com as alterações
gravadas no banco (`landing_pages` + `landing_page_sections`) — não em arquivos (ADR 0015). A edição
de rascunho é **síncrona** (request/response, sem fila); apenas a publicação (job pesado) é
enfileirada (ADR 0009). O conteúdo continua sendo a fonte da verdade no Supabase, serializado por
`@template/lp-render` (ADR 0017) só na hora de publicar (Onda 8). Esta onda entrega:

- `components/landing/*` — UI do editor por seção (formulários derivados do schema de cada seção).
- `lib/api/landing-pages.ts` — camada de aplicação da edição: validação **Zod por seção**,
  `edit-path` (caminho do campo) e `reconcile` (mescla validada do patch no estado persistido).

## Contratos

### Modelo de dados (SPEC-000 §6 — landing)

Edição opera sobre:

- **`landing_pages`**: `settings jsonb`, `theme jsonb`, `draft_status`
  (`empty/generating/ready/editing/publishing`), `status`, `published_snapshot jsonb`, `noindex`.
- **`landing_page_sections`** (`landing_page_id`+`type` único): `position`, `enabled`,
  `fields jsonb`, `version`.

Invariantes:

- **Dinheiro em centavos**: qualquer campo monetário de seção/oferta é `integer` de centavos
  (nunca float).
- **Conteúdo no banco, não em arquivo** (ADR 0015): o editor escreve `fields`/`settings`/`theme`;
  nenhuma escrita de arquivo de LP nesta onda.
- **`version` monotônico por seção**: cada edição aceita incrementa `landing_page_sections.version`
  (base para optimistic concurrency e auditoria).
- **Edição não publica**: editar só muda o rascunho (`draft_status='editing'`); ir ao ar é um job
  `landing_publish` separado.

### Schemas Zod por seção (esboço)

Cada tipo de seção tem um schema Zod próprio; o registry resolve `type → schema`. Validação é
**deny-by-default**: tipo desconhecido é rejeitado, não passa cru.

```ts
// lib/api/landing-pages.ts (esboço — TS estrito, sem any)
import { z } from "zod";

const cents = z.number().int().nonnegative(); // money is integer cents

// Per-section field schemas (one per known section type; 17 sections from @template/lp-render).
const heroFields = z.object({
  headline: z.string().min(1).max(120),
  subheadline: z.string().max(240).optional(),
  ctaLabel: z.string().min(1).max(40),
});
const offerFields = z.object({
  priceCents: cents,          // never float
  compareAtCents: cents.optional(),
  currency: z.string().length(3),
});
// ...one schema per section type...

// Server-side allowlist: section type -> schema (deny-by-default).
const SECTION_SCHEMAS = {
  hero: heroFields,
  offer: offerFields,
  // ...
} as const;
type SectionType = keyof typeof SECTION_SCHEMAS;

// A single edit targets one section + one field path (edit-path).
const EditRequest = z.object({
  landingPageId: z.string().uuid(),
  sectionType: z.enum(
    Object.keys(SECTION_SCHEMAS) as [SectionType, ...SectionType[]],
  ),
  // edit-path: dotted path into the section fields (charset-restricted, no proto pollution).
  path: z.string().regex(/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/).max(120),
  value: z.unknown(),          // narrowed by the section schema during reconcile
  expectedVersion: z.number().int().nonnegative(), // optimistic concurrency
});
type EditRequest = z.infer<typeof EditRequest>;
```

### edit-path + reconcile

- **edit-path**: identifica o campo dentro de `fields` por caminho pontilhado, com charset restrito
  (`[a-zA-Z0-9_.]`) — barra `__proto__`/`constructor`/`prototype` e injeção de chave. Profundidade
  máxima limitada.
- **reconcile**: aplica o patch sobre uma cópia do `fields` atual, **valida o objeto resultante
  inteiro** com o schema da seção (não só o campo), e só persiste se válido. É a função que garante
  que nenhum estado inválido chega ao banco.

```ts
function reconcile(
  current: Record<string, unknown>,
  edit: EditRequest,
): { ok: true; next: Record<string, unknown> } | { ok: false; issues: z.ZodIssue[] } {
  const schema = SECTION_SCHEMAS[edit.sectionType as SectionType];
  const candidate = setByPath(structuredClone(current), edit.path, edit.value);
  const parsed = schema.safeParse(candidate); // whole-section validation
  return parsed.success ? { ok: true, next: parsed.data } : { ok: false, issues: parsed.error.issues };
}
```

### Endpoint (Hono, dashboard)

`PATCH /api/landing-pages/:id/sections/:type` — corpo `EditRequest`. Ordem obrigatória
`auth → authz → validação (Zod) → lógica (reconcile + persist)`. Resposta: seção atualizada
(`fields`, novo `version`) ou `409` em conflito de versão / `422` em falha de schema.

## Comportamento

- **Fluxo feliz**: operador edita um campo → `PATCH` → Zod valida `EditRequest` → `reconcile`
  (valida seção inteira) → UPDATE em `landing_page_sections` (`fields`, `version+1`,
  `landing_pages.draft_status='editing'`) → retorna estado novo → UI atualiza.
- **Concorrência (optimistic)**: `expectedVersion` ≠ `version` atual → `409 conflict`; a UI recarrega
  a seção e pede ao operador para refazer. Evita *lost update* entre o editor e o modo autônomo
  (que também pode tocar a LP).
- **Idempotência**: aplicar o mesmo patch (mesmo `path`/`value`) sobre o mesmo estado é
  determinístico; reenvio com `expectedVersion` já consumido cai em `409` (não duplica efeito).
- **Erros**: schema inválido → `422` com `issues` (sem vazar internals); seção/tipo desconhecido →
  `404`/`422`; LP em `publishing` → edição bloqueada (`409`/`423`) até o publish concluir.
- **Publicação** continua sendo job `landing_publish` enfileirado (Onda 8) — fora do escopo síncrono
  deste editor; o editor pode **enfileirar** o publish (insert em `agent_jobs`), nunca executá-lo.

## Segurança

- **Ordem em toda rota**: `auth → authz → validação → lógica` (§11). Sessão exigida (middleware da
  Onda 6); leituras/escritas de tabela **server-side** via `service_role` (RLS fechada ao browser).
- **Validação em fronteira**: todo corpo passa por Zod; `value` é `unknown` até a validação da seção
  (narrowing). `path` com charset restrito impede **prototype pollution** e injeção de chave.
- **RLS deny-by-default**: o browser nunca lê/escreve `landing_page_sections` direto — sempre via API
  server-side.
- **Segredos**: `SUPABASE_SECRET_KEY` só server-side; nada em `NEXT_PUBLIC_*`.
- **PII**: o editor não loga conteúdo sensível; logs estruturados sem PII.
- **Headers**: respostas herdam HSTS/CSP(nonce)/X-Content-Type-Options/X-Frame-Options/
  Referrer-Policy do middleware.
- **Rate limit**: o endpoint de edição é autenticado; aplicar rate limit por sessão para evitar
  abuso/flood de patches (Upstash).
- **Threat model STRIDE**: superfície nova (API de edição) → atualizar
  [`docs/security/threats/landing-page-editor.md`](../security/threats/landing-page-editor.md)
  (Tampering: prototype pollution via `path`; EoP: edição sem sessão; DoS: flood de patches).

## Critérios de aceite

> Fecham o **gate da Onda 9** em [`WAVES.md`](../../WAVES.md) (parte do editor de LP).

1. **Editar um campo no dashboard atualiza `landing_page_sections`** (o `fields` muda e `version`
   incrementa).
2. Edição é **síncrona** (request/response); **nenhum** job é criado para editar rascunho.
3. Schema inválido é rejeitado (`422`) **antes** de tocar o banco; `path` malicioso
   (`__proto__`/`constructor`) é bloqueado.
4. Conflito de versão (`expectedVersion` desatualizado) retorna `409` sem aplicar (sem lost update).
5. Dinheiro de seção persistido como **inteiro de centavos**.
6. `npm run lint && npm run typecheck && npm test` verdes; `cd web && npm run build` verde.

## Testes

- **Unit (application/domain, sem I/O)**: `reconcile` (patch válido/ inválido; valida seção inteira);
  `setByPath` rejeita `__proto__`/profundidade excessiva; schema por seção (campos obrigatórios,
  money em centavos, limites de tamanho).
- **Integração (I/O)**: `PATCH` happy-path persiste `fields`+`version`; `409` em versão obsoleta;
  `422` em schema inválido; edição bloqueada quando LP em `publishing`.
- **e2e (seletivo)**: operador autenticado edita um campo no editor e vê a mudança refletida
  (fluxo crítico de edição de LP).
