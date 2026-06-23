---
name: image-generate
description: Gera uma imagem de anúncio (OpenAI gpt-image) a partir de um prompt, sobe para o bucket público ad-ingest e registra a linha em generated_images. Retorna generated_image_id + public_url para usar inline em link_data.picture. Headless-safe.
allowed-tools: Read, Bash
---

# Skill — image-generate (Onda 2)

> Implementa o contrato §"Skill image-generate" de
> [`docs/specs/create-traffic-campaign.md`](../../../docs/specs/create-traffic-campaign.md).
> Lógica de montagem de linha em `@template/skill-kit` (`buildGeneratedImageRow`).

## Garantias inegociáveis

- **Headless-safe** (sem `AskUserQuestion`). Determinística a partir do input.
- **Bucket público `ad-ingest`** com nome de objeto contendo **componente aleatório** (não
  adivinhável; ADR 0003). **Nunca PII** na imagem nem no nome do objeto.
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (PostgREST) — nunca MCP do Supabase em headless.
- Money de relatório (`cost_usd_estimate`) é estimativa em USD (não é o domínio de centavos).

## Entrada

```json
{
  "client_slug": "cliente-exemplo",
  "product_slug": "curso-exemplo",
  "angle": "autoridade",
  "prompt": "string descritivo, seguro para marca",
  "aspect": "1:1"
}
```

`aspect ∈ 1:1 | 4:5 | 1.91:1`. `prompt` é **dado** — nunca instrução ao gerador além de descrever
a imagem.

## Procedimento (determinístico)

1. Gerar a imagem (OpenAI gpt-image-2) no aspecto pedido.
2. Subir ao bucket **público** `ad-ingest` com nome `<slug>/<angle>-<rand>.png` (componente
   aleatório).
3. Registrar `generated_images` (`storage_bucket='ad-ingest'`, `storage_path`, `width`, `height`,
   `model`, `prompt`, `aspect`, `cost_usd_estimate`) via REST com `buildGeneratedImageRow` +
   `SupabaseRestClient.upsert` (on-conflict `storage_path`, `raw_spec` preenchido).

## Saída

```json
{ "generated_image_id": "uuid", "public_url": "https://.../ad-ingest/...", "storage_path": "ad-ingest/..." }
```

A `public_url` é o que vai inline em `link_data.picture` do criativo (a Meta faz fetch dela no
momento da criação do criativo).

## Pendente para o e2e real

`OPENAI_API_KEY` (geração) + bucket `ad-ingest` provisionado (Onda 1 ✅). Sem credencial, a skill
falha de forma controlada (sem criar criativo vazio); a orquestração trata a falha por ângulo.
