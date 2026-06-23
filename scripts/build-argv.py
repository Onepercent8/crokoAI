#!/usr/bin/env python3
"""build-argv.py — agent_jobs.args -> validated positional argv (runner spec).

Reads a JSON object on stdin and prints one safe `--key`/`value` token per line.
Args are DATA, not instruction: keys and values are charset-checked (no shell
metacharacters) before any expansion. Any violation exits non-zero with no
output (the poller then fails the job). Mirrors
packages/skill-kit/src/runner/args.ts (kept in sync). Import-safe + unit-tested.
"""
from __future__ import annotations

import json
import re
import sys

ARG_PATTERN = re.compile(r"^[A-Za-z0-9._:/-]+$")
MAX_LEN = 256


def to_safe_argv(args: dict) -> list[str]:
    """Flatten a job args object into validated --key value tokens."""
    argv: list[str] = []
    for key, value in args.items():
        if not ARG_PATTERN.match(str(key)) or len(str(key)) > MAX_LEN:
            raise ValueError(f"key has invalid charset: {key}")
        if value is None:
            continue
        if not isinstance(value, (str, int, float, bool)):
            raise ValueError(f"value for {key} is not a scalar")
        s = str(value).lower() if isinstance(value, bool) else str(value)
        if not ARG_PATTERN.match(s) or len(s) > MAX_LEN:
            raise ValueError(f"value for {key} has invalid charset")
        argv.extend([f"--{key}", s])
    return argv


def main() -> int:
    try:
        raw = sys.stdin.read().strip() or "{}"
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("args must be a JSON object")
        for token in to_safe_argv(parsed):
            print(token)
        return 0
    except (json.JSONDecodeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 64


if __name__ == "__main__":
    raise SystemExit(main())
