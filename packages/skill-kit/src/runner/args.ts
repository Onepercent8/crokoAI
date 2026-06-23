/**
 * Skill-arg charset validation (flyio-cron-campaign-runner §Validação de args).
 *
 * Args passed to `claude -p` are DATA, not instruction. They must pass a
 * restricted-charset check (no shell metacharacters) BEFORE any expansion, to
 * defend against command injection and prompt-injection via `args.jsonb`.
 */

import { z } from 'zod';

/** Positional arg charset accepted by run-skill.sh (no shell metacharacters). */
export const SKILL_ARG_PATTERN = /^[A-Za-z0-9._:\-/]+$/;

export const SkillArgSchema = z.string().min(1).max(256).regex(SKILL_ARG_PATTERN);

/** True when a single arg is safe to pass to the shell executor. */
export function isSafeSkillArg(arg: string): boolean {
  return SkillArgSchema.safeParse(arg).success;
}

/**
 * Flatten a job `args` object into validated positional `--key value` pairs.
 * Keys and values are charset-checked; any violation throws (job -> failed).
 * Values are coerced to string; only string/number/boolean are accepted.
 */
export function toSafeArgv(args: Record<string, unknown>): string[] {
  const argv: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (!SKILL_ARG_PATTERN.test(key)) {
      throw new Error(`Failed to build argv: key "${key}" has invalid charset`);
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Failed to build argv: value for "${key}" is not a scalar`);
    }
    const str = String(value);
    if (!SKILL_ARG_PATTERN.test(str)) {
      throw new Error(`Failed to build argv: value for "${key}" has invalid charset`);
    }
    argv.push(`--${key}`, str);
  }
  return argv;
}
