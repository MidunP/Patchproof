-- ── Repro Database Schema ───────────────────────────────────────────────────
-- Designed to capture every state transition and every log line so
-- a crash at any point leaves enough state to diagnose the failure.

CREATE TABLE IF NOT EXISTS runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url      TEXT NOT NULL,
  issue_number  INTEGER NOT NULL,
  issue_title   TEXT NOT NULL DEFAULT '',
  issue_body    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN (
                    'queued', 'cloning', 'reproducing',
                    'patching', 'verifying', 'pr_opened', 'failed'
                  )),
  attempt       INTEGER NOT NULL DEFAULT 0,
  pr_url        TEXT,
  failure_reason TEXT,
  token_usage   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per state transition — immutable audit trail
CREATE TABLE IF NOT EXISTS steps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  attempt    INTEGER NOT NULL DEFAULT 0,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only log lines streamed during execution
CREATE TABLE IF NOT EXISTS logs (
  id         BIGSERIAL PRIMARY KEY,
  run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'info'
               CHECK (level IN ('info', 'warn', 'error', 'debug')),
  source     TEXT NOT NULL DEFAULT 'system',  -- 'agent', 'sandbox', 'system'
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the common query patterns
CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
CREATE INDEX IF NOT EXISTS idx_logs_run_id  ON logs(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);
CREATE INDEX IF NOT EXISTS idx_logs_run_created ON logs(run_id, created_at);

-- Auto-update updated_at on runs
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER runs_updated_at
  BEFORE UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
