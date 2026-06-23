#!/usr/bin/env python3
"""Unit tests for the runner Python helpers (SPEC flyio-cron-campaign-runner).

Pure-logic tests only (no network, no Supabase). Run with:
    python3 -m unittest discover -s scripts/test -p 'test_*.py'
"""
import importlib.util
import os
import sys
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(name, filename):
    path = os.path.join(SCRIPTS, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


emit = _load("emit_from_stream", "emit-from-stream.py")
resolve = _load("resolve_kind", "resolve-kind.py")
build_argv = _load("build_argv", "build-argv.py")


class TestResolveKind(unittest.TestCase):
    def test_resolves_known_kinds(self):
        self.assertEqual(
            resolve.resolve_kind_to_slug("create"),
            "create-traffic-cliente-exemplo-campaign",
        )
        self.assertEqual(
            resolve.resolve_kind_to_slug("analyze"),
            "funnel-analytics-cliente-exemplo-campaign",
        )

    def test_unknown_kind_raises(self):
        with self.assertRaises(KeyError):
            resolve.resolve_kind_to_slug("rm -rf")

    def test_landing_edit_not_routed(self):
        with self.assertRaises(KeyError):
            resolve.resolve_kind_to_slug("landing_edit")

    def test_all_slugs_charset(self):
        import re

        for slug in resolve.KIND_TO_SLUG.values():
            self.assertRegex(slug, re.compile(r"^[a-z0-9-]+$"))


class TestBuildArgv(unittest.TestCase):
    def test_flattens_scalars(self):
        self.assertEqual(
            build_argv.to_safe_argv({"client_slug": "cliente-exemplo", "window_days": 7}),
            ["--client_slug", "cliente-exemplo", "--window_days", "7"],
        )

    def test_booleans_and_none(self):
        self.assertEqual(
            build_argv.to_safe_argv({"compare": True, "missing": None}),
            ["--compare", "true"],
        )

    def test_rejects_metacharacters(self):
        with self.assertRaises(ValueError):
            build_argv.to_safe_argv({"client_slug": "a; rm -rf /"})

    def test_rejects_non_scalar(self):
        with self.assertRaises(ValueError):
            build_argv.to_safe_argv({"payload": {"x": 1}})

    def test_rejects_bad_key(self):
        with self.assertRaises(ValueError):
            build_argv.to_safe_argv({"bad key": "x"})


class TestStreamEvents(unittest.TestCase):
    def test_map_system_init_to_start(self):
        ev = emit.map_line({"type": "system", "subtype": "init"}, "r", "skill")
        self.assertEqual(ev["event_type"], "start")
        self.assertEqual(ev["agent_type"], "system")

    def test_map_result_to_end(self):
        ev = emit.map_line({"type": "result"}, "r", "skill")
        self.assertEqual(ev["event_type"], "end")

    def test_map_tool_use_to_decision(self):
        ev = emit.map_line({"type": "tool_use", "name": "Read"}, "r", "skill")
        self.assertEqual(ev["event_type"], "decision")
        self.assertEqual(ev["tool_name"], "Read")

    def test_map_error(self):
        ev = emit.map_line({"type": "assistant", "is_error": True}, "r", "skill")
        self.assertEqual(ev["event_type"], "error")

    def test_unknown_returns_none(self):
        self.assertIsNone(emit.map_line({"type": "whatever"}, "r", "skill"))

    def test_strip_payload_drops_pii(self):
        out = emit.strip_payload(
            {"subtype": "init", "email": "a@b.com", "content": "x", "nested": {"y": 1}}
        )
        self.assertEqual(out, {"subtype": "init"})

    def test_parse_stream_skips_malformed(self):
        import json

        chunk = "\n".join(
            [
                json.dumps({"type": "system", "subtype": "init"}),
                "not json",
                json.dumps({"type": "tool_use", "name": "Read"}),
                json.dumps({"type": "result"}),
                "",
            ]
        )
        events = emit.parse_stream(chunk, "r", "skill")
        self.assertEqual([e["event_type"] for e in events], ["start", "decision", "end"])


if __name__ == "__main__":
    unittest.main()
