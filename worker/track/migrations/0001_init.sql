-- D1 schema for the tracking Worker (SPEC-015, Onda 10).
-- Edge state only: event_id dedup + per-IP rate counters. NO PII (the rate key
-- is a SHA-256 of the IP; the raw IP is never stored).

CREATE TABLE IF NOT EXISTS seen_events (
  event_id TEXT PRIMARY KEY,
  seen_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_counters (
  key          TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
