#!/usr/bin/env node
/**
 * screenshot-page.cjs — capture a landing-page preview frame for the live review
 * (SPEC-014, ADR 0020). CommonJS so the runner can invoke it directly with
 * Playwright installed.
 *
 * SECURITY (SSRF): screenshotting a data-controlled URL is a classic SSRF
 * surface. This script REVALIDATES the URL against the same allowlist the TS
 * side uses (`web/lib/nexus/review-frame.ts`) BEFORE launching a browser
 * (defense in depth). Fail-safe: any URL not provably inside `*.example.com`
 * over HTTPS is BLOCKED — the browser is never launched for it.
 *
 * Usage:  node scripts/screenshot-page.cjs <https-url> <out.png>
 * Exit:   0 captured · 64 ssrf-blocked · 65 bad-args · 70 capture-failed
 */
'use strict';

/** Template placeholder allowlist suffix (swap with the real domain). */
const ALLOWED_SUFFIX = '.example.com';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Validate the target URL; throws on any unsafe URL (fail-safe = block). */
function assertSafeUrl(raw) {
  const u = new URL(raw); // throws on malformed
  if (u.protocol !== 'https:') throw new Error('ssrf: protocol not allowed');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('ssrf: localhost');
  if (IPV4.test(host)) throw new Error('ssrf: literal ipv4'); // covers 169.254.169.254
  if (host.includes(':') || host === '[::1]') throw new Error('ssrf: literal ipv6');
  if (!host.endsWith(ALLOWED_SUFFIX)) throw new Error('ssrf: host outside allowlist');
  return u.toString();
}

// Exported for the unit test (the test requires this module and calls the guard
// without launching a browser).
module.exports = { assertSafeUrl, ALLOWED_SUFFIX };

async function main() {
  const [rawUrl, outPath] = process.argv.slice(2);
  if (!rawUrl || !outPath) {
    console.error('usage: screenshot-page.cjs <https-url> <out.png>');
    process.exit(65);
  }

  let safeUrl;
  try {
    safeUrl = assertSafeUrl(rawUrl);
  } catch (err) {
    // Fail-safe: never navigate to a blocked URL.
    console.error(
      JSON.stringify({ level: 'warn', op: 'screenshot.blocked', message: err.message }),
    );
    process.exit(64);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error(
      JSON.stringify({
        level: 'error',
        op: 'screenshot.deps',
        message: 'playwright not installed',
      }),
    );
    process.exit(70);
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(safeUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: outPath, fullPage: true });
    console.error(JSON.stringify({ level: 'info', op: 'screenshot.ok', out: outPath }));
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({ level: 'error', op: 'screenshot.failed', message: err.message }),
    );
    process.exit(70);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Only run when invoked directly (not when required by the test).
if (require.main === module) {
  void main();
}
