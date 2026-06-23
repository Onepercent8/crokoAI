#!/usr/bin/env python3
"""resolve-kind.py — kind -> skill slug allowlist (SPEC flyio-cron-campaign-runner).

Server-side allowlist: the job `kind` is mapped to a skill slug here; a slug is
NEVER built from free text (security.md). Unknown / non-routable kinds exit
non-zero with no output so the poller marks the job `failed` without executing.
Mirrors packages/skill-kit/src/runner/allowlist.ts (kept in sync). Import-safe
and unit-tested.
"""
from __future__ import annotations

import re
import sys

KIND_TO_SLUG = {
    "create": "create-traffic-cliente-exemplo-campaign",
    "create_sales": "create-sales-cliente-exemplo-campaign",
    "activate": "activate-campaign-cliente-exemplo",
    "analyze": "funnel-analytics-cliente-exemplo-campaign",
    "summarize": "daily-summary-cliente-exemplo",
    "landing": "create-landing-page-cliente-exemplo",
    "landing_publish": "publish-landing-page-cliente-exemplo",
    # landing_edit is synchronous in the dashboard — NOT runner-routed.
}

SLUG_PATTERN = re.compile(r"^[a-z0-9-]+$")


def resolve_kind_to_slug(kind: str) -> str:
    """Return the allowlisted slug for a kind, or raise on unknown/invalid."""
    slug = KIND_TO_SLUG.get(kind)
    if slug is None:
        raise KeyError(f"kind not in allowlist: {kind}")
    if not SLUG_PATTERN.match(slug):
        raise ValueError("resolved slug has invalid charset")
    return slug


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: resolve-kind.py <kind>", file=sys.stderr)
        return 64
    try:
        print(resolve_kind_to_slug(argv[0]))
        return 0
    except (KeyError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 65


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
