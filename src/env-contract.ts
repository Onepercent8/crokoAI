/**
 * Contrato de variáveis de ambiente (espelho tipado de `.env.example`, SPEC-000 §2/§7).
 *
 * Fonte da verdade dos NOMES das variáveis. A validação real (Zod) e a leitura tipada
 * entram em `web/lib/env.ts` na Onda 6. Aqui só listamos o contrato para checagem estática
 * e para scripts de scaffolding usarem como referência única.
 */

/** Variáveis obrigatórias para o sistema operar (dev/prod). */
export const REQUIRED_ENV_VARS = [
  'CLAUDE_API_KEY',
  'OPENAI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'PICOVOICE_ACCESS_KEY',
  'NEXT_PUBLIC_PICOVOICE_ACCESS_KEY',
  'DASHBOARD_PASSWORD',
  'AUTH_SECRET',
] as const;

/** Variáveis opcionais (recursos degradam para log/no-op quando ausentes). */
export const OPTIONAL_ENV_VARS = [
  'NEXUS_MODEL',
  'NEXUS_REVIEW_MODEL',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'CLOUDFLARE_TURNSTILE_SITE_KEY',
  'CLOUDFLARE_TURNSTILE_SECRET_KEY',
  'RESEND_API_KEY',
  'AUTONOMOUS_NOTIFY_EMAIL',
  'AUTONOMOUS_FROM_EMAIL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];
export type OptionalEnvVar = (typeof OPTIONAL_ENV_VARS)[number];
