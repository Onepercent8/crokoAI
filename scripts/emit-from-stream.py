#!/usr/bin/env python3
"""emit-from-stream.py — stream-json -> agent_events (SPEC flyio-cron-campaign-runner).

Reads Claude Code `--output-format stream-json` on stdin (one JSON object per
line) and inserts append-only telemetry into `agent_events` via PostgREST
(REST + SUPABASE_SECRET_KEY; NEVER the Supabase MCP, SPEC-000 §10). NO-PII: the
payload is stripped to a small allowlist of safe scalar keys. Mirrors the pure
TS mapper in packages/skill-kit/src/runner/stream-events.ts (kept in sync).

This module is import-safe and unit-tested (test/test_emit_from_stream.py): the
pure mapping functions have NO side effects; only main() touches the network.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# Keys allowed to survive into a telemetry payload (everything else dropped).
SAFE_PAYLOAD_KEYS = {
    "subtype",
    "tool",
    "tool_name",
    "name",
    "duration_ms",
    "num_turns",
    "is_error",
    "exit_code",
    "model",
}


def strip_payload(obj: dict) -> dict:
    """Keep only safe, non-PII scalar keys."""
    out = {}
    for key, value in obj.items():
        if key in SAFE_PAYLOAD_KEYS and not isinstance(value, (dict, list)):
            out[key] = value
    return out


def map_line(line: dict, run_id: str, agent_name: str) -> dict | None:
    """Map one parsed stream-json object to an AgentEvent dict (or None)."""
    type_ = line.get("type") if isinstance(line.get("type"), str) else ""
    base = {
        "run_id": run_id,
        "agent_name": agent_name,
        "tool_name": None,
        "payload": strip_payload(line),
    }
    if line.get("is_error") is True or type_ == "error":
        return {**base, "agent_type": "system", "event_type": "error"}
    if type_ == "system":
        return {**base, "agent_type": "system", "event_type": "start"}
    if type_ == "result":
        return {**base, "agent_type": "system", "event_type": "end"}
    tool_name = None
    if isinstance(line.get("tool_name"), str):
        tool_name = line["tool_name"]
    elif isinstance(line.get("tool"), str):
        tool_name = line["tool"]
    elif isinstance(line.get("name"), str) and type_ == "tool_use":
        tool_name = line["name"]
    if tool_name is not None or type_ in ("tool_use", "tool_result"):
        return {**base, "agent_type": "tool", "event_type": "decision", "tool_name": tool_name}
    if type_ in ("assistant", "user"):
        return {**base, "agent_type": "skill", "event_type": "step"}
    return None


def parse_stream(chunk: str, run_id: str, agent_name: str) -> list[dict]:
    """Parse stream-json text into events; skip malformed/non-telemetry lines."""
    events = []
    for raw in chunk.split("\n"):
        trimmed = raw.strip()
        if not trimmed:
            continue
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        event = map_line(parsed, run_id, agent_name)
        if event is not None:
            events.append(event)
    return events


def _post_event(event: dict) -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        # Offline / no creds: print for the disk log, do not crash the run.
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
    except urllib.error.URLError as exc:  # never crash the skill on telemetry
        print(f"emit: failed to post agent_event: {exc}", file=sys.stderr)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--agent-name", required=True)
    parser.add_argument("--emit-start", action="store_true")
    parser.add_argument("--emit-end", action="store_true")
    parser.add_argument("--exit-code", type=int, default=0)
    args = parser.parse_args(argv)

    if args.emit_start:
        _post_event(
            {
                "run_id": args.run_id,
                "agent_name": args.agent_name,
                "agent_type": "skill",
                "event_type": "start",
                "tool_name": None,
                "payload": {},
            }
        )
        return 0
    if args.emit_end:
        _post_event(
            {
                "run_id": args.run_id,
                "agent_name": args.agent_name,
                "agent_type": "skill",
                "event_type": "end",
                "tool_name": None,
                "payload": {"exit_code": args.exit_code},
            }
        )
        return 0

    chunk = sys.stdin.read()
    for event in parse_stream(chunk, args.run_id, args.agent_name):
        _post_event(event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
