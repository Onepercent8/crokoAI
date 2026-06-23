#!/usr/bin/env python3
"""emit-agent-event.py — Claude Code lifecycle hook -> agent_events (Onda 3).

Configured as a Claude Code hook so the runtime emits append-only telemetry from
the agent's OWN lifecycle (PreToolUse/PostToolUse/Stop/SubagentStop), in addition
to the stream parser. Claude Code passes the hook event as JSON on stdin. We map
it to an `agent_events` row and POST via REST + SUPABASE_SECRET_KEY (NEVER the
Supabase MCP, SPEC-000 §10). NO-PII: only safe scalar keys survive. Never blocks
the agent: any error exits 0.

run_id correlation: RUN_ID is exported by run-skill.sh into the environment.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

SAFE_KEYS = {"tool_name", "tool", "hook_event_name", "subtype", "exit_code", "model"}

# Map a Claude Code hook event name to an (agent_type, event_type) pair.
HOOK_MAP = {
    "PreToolUse": ("tool", "decision"),
    "PostToolUse": ("tool", "decision"),
    "SubagentStop": ("subagent", "end"),
    "Stop": ("skill", "end"),
    "SessionStart": ("system", "start"),
    "Notification": ("system", "step"),
}


def strip_payload(obj: dict) -> dict:
    return {k: v for k, v in obj.items() if k in SAFE_KEYS and not isinstance(v, (dict, list))}


def build_event(hook_input: dict, run_id: str, agent_name: str) -> dict:
    hook_name = hook_input.get("hook_event_name", "Notification")
    agent_type, event_type = HOOK_MAP.get(hook_name, ("system", "step"))
    tool = hook_input.get("tool_name")
    return {
        "run_id": run_id,
        "agent_name": agent_name,
        "agent_type": agent_type,
        "event_type": event_type,
        "tool_name": tool if isinstance(tool, str) else None,
        "payload": strip_payload(hook_input),
    }


def post_event(event: dict) -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print(json.dumps(event), file=sys.stderr)
        return
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/agent_events",
        data=json.dumps([event]).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except urllib.error.URLError as exc:
        print(f"hook: failed to post agent_event: {exc}", file=sys.stderr)


def main() -> int:
    try:
        raw = sys.stdin.read().strip() or "{}"
        hook_input = json.loads(raw)
        if not isinstance(hook_input, dict):
            return 0
        run_id = os.environ.get("RUN_ID", "unknown")
        agent_name = os.environ.get("SKILL_SLUG", "claude-code")
        post_event(build_event(hook_input, run_id, agent_name))
    except Exception as exc:  # noqa: BLE001 — a hook must never block the agent
        print(f"hook: ignored error: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
