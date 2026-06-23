import { describe, expect, it } from 'vitest';

import { parseLoginBody, responseModeFor } from '../lib/auth/login-request';

describe('login-request: parseLoginBody', () => {
  it('parses a JSON body (hydrated fetch client)', () => {
    const body = parseLoginBody('application/json', { password: 'hunter2' });
    expect(body).toEqual({ password: 'hunter2' });
  });

  it('parses a URL-encoded body (no-JS native form POST)', () => {
    // Regression (NOTES §7): without JS the form must POST form-encoded so the
    // password never lands in the URL. The endpoint must accept this shape.
    const raw = new URLSearchParams({ password: 'hunter2' }).toString();
    const body = parseLoginBody('application/x-www-form-urlencoded', raw);
    expect(body).toEqual({ password: 'hunter2' });
  });

  it('maps the Turnstile widget field name from a form POST', () => {
    const raw = new URLSearchParams({
      password: 'hunter2',
      'cf-turnstile-response': 'tok',
    }).toString();
    const body = parseLoginBody('application/x-www-form-urlencoded', raw);
    expect(body).toEqual({ password: 'hunter2', turnstileToken: 'tok' });
  });

  it('rejects a form POST with no password', () => {
    const raw = new URLSearchParams({ other: 'x' }).toString();
    expect(parseLoginBody('application/x-www-form-urlencoded', raw)).toBeNull();
  });

  it('rejects an empty password', () => {
    expect(parseLoginBody('application/json', { password: '' })).toBeNull();
  });

  it('rejects a non-string / null body', () => {
    expect(parseLoginBody('application/json', null)).toBeNull();
    expect(parseLoginBody('application/json', 'not-an-object')).toBeNull();
  });

  it('rejects an over-long password (DoS guard)', () => {
    expect(parseLoginBody('application/json', { password: 'a'.repeat(513) })).toBeNull();
  });
});

describe('login-request: responseModeFor', () => {
  it('returns json for an application/json request', () => {
    expect(responseModeFor('application/json')).toBe('json');
    expect(responseModeFor('application/json; charset=utf-8')).toBe('json');
  });

  it('returns redirect for a form-encoded (no-JS) request', () => {
    expect(responseModeFor('application/x-www-form-urlencoded')).toBe('redirect');
  });

  it('defaults to redirect when content-type is absent', () => {
    expect(responseModeFor(undefined)).toBe('redirect');
  });
});
