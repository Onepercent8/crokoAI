#!/usr/bin/env node
/**
 * send-email.cjs — best-effort notification email for the autonomous mode's
 * `notifying` phase (SPEC-013/014, ADR 0019). Optional + degradable: if the
 * Resend key or recipient is absent, OR delivery fails, it logs and exits 0
 * (degraded-to-log). It MUST NEVER fail the watch (fail-safe invariant).
 *
 * Usage:  node scripts/send-email.cjs <subject> <body>
 * Env:    RESEND_API_KEY, AUTONOMOUS_FROM_EMAIL, AUTONOMOUS_NOTIFY_EMAIL
 * Exit:   0 always (sent OR degraded-to-log). Body/subject carry NO PII.
 */
'use strict';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Decide what to do given the env + args (pure; exported for the unit test). */
function planSend(env, subject, body) {
  if (!subject || !body) {
    return { action: 'skip', reason: 'missing subject/body' };
  }
  const key = env.RESEND_API_KEY;
  const from = env.AUTONOMOUS_FROM_EMAIL;
  const to = env.AUTONOMOUS_NOTIFY_EMAIL;
  if (!key || !from || !to) {
    // Optional: absent config degrades to log-only (not an error).
    return { action: 'degrade', reason: 'resend not configured' };
  }
  return { action: 'send', from, to, key };
}

module.exports = { planSend };

async function main() {
  const [subject, body] = process.argv.slice(2);
  const plan = planSend(process.env, subject, body);

  if (plan.action !== 'send') {
    console.error(JSON.stringify({ level: 'info', op: 'email.degraded', reason: plan.reason }));
    process.exit(0); // fail-safe: degrade to log
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${plan.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: plan.from, to: plan.to, subject, text: body }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ level: 'warn', op: 'email.failed', status: res.status }));
      process.exit(0); // degrade to log; never fail the watch
    }
    console.error(JSON.stringify({ level: 'info', op: 'email.sent' }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', op: 'email.error', message: err.message }));
    process.exit(0); // fail-safe
  }
}

if (require.main === module) {
  void main();
}
