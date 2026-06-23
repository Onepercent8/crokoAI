import { describe, expect, it } from 'vitest';
import { isSafeSkillArg, toSafeArgv } from './args.js';

describe('isSafeSkillArg', () => {
  it('accepts safe slugs/ids/paths', () => {
    expect(isSafeSkillArg('cliente-exemplo')).toBe(true);
    expect(isSafeSkillArg('act_123:abc.def/sub')).toBe(true);
  });

  it('rejects shell metacharacters', () => {
    for (const bad of ['a;b', 'a b', 'a$(x)', 'a|b', 'a&b', 'a`b`', "a'b", 'a>b', 'a\nb']) {
      expect(isSafeSkillArg(bad)).toBe(false);
    }
  });

  it('rejects empty and over-long args', () => {
    expect(isSafeSkillArg('')).toBe(false);
    expect(isSafeSkillArg('a'.repeat(257))).toBe(false);
  });
});

describe('toSafeArgv', () => {
  it('flattens scalar args into --key value pairs', () => {
    expect(toSafeArgv({ client_slug: 'cliente-exemplo', window_days: 7 })).toEqual([
      '--client_slug',
      'cliente-exemplo',
      '--window_days',
      '7',
    ]);
  });

  it('coerces booleans and skips null/undefined', () => {
    expect(toSafeArgv({ compare: true, missing: null, gone: undefined })).toEqual([
      '--compare',
      'true',
    ]);
  });

  it('throws on a value with shell metacharacters', () => {
    expect(() => toSafeArgv({ client_slug: 'a; rm -rf /' })).toThrow(/invalid charset/);
  });

  it('throws on a non-scalar value', () => {
    expect(() => toSafeArgv({ payload: { nested: 1 } })).toThrow(/not a scalar/);
  });

  it('throws on a key with invalid charset', () => {
    expect(() => toSafeArgv({ 'bad key': 'x' })).toThrow(/key/);
  });
});
