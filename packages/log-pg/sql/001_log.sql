-- The log (01 §7). Three tables are the log itself; identity_counters is the
-- write-side allocation index (identity existence + the per-app batch counter),
-- a cache derivable from the log. Projections are rebuilt by replay.

CREATE TABLE IF NOT EXISTS blocks (
  number     BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS txs (
  block     BIGINT NOT NULL REFERENCES blocks(number),
  idx       INT    NOT NULL,
  initiator BIGINT NOT NULL,
  type      TEXT   NOT NULL,
  payload   JSONB  NOT NULL,
  PRIMARY KEY (block, idx)
);

CREATE TABLE IF NOT EXISTS events (
  app BIGINT NOT NULL, batch BIGINT NOT NULL, usr BIGINT NOT NULL, seq BIGINT NOT NULL,
  version    SMALLINT NOT NULL DEFAULT 1,
  type_app BIGINT NOT NULL, type_batch BIGINT NOT NULL, type_usr BIGINT NOT NULL, type_seq BIGINT NOT NULL,
  ref_app  BIGINT, ref_batch  BIGINT, ref_usr  BIGINT, ref_seq  BIGINT,
  supersedes BOOLEAN NOT NULL DEFAULT FALSE,   -- the supersede flag: ref = previous version (04 §3)
  auth_app BIGINT, auth_batch BIGINT, auth_usr BIGINT, auth_seq BIGINT,
  signature  BYTEA,
  visibility SMALLINT NOT NULL DEFAULT 0,      -- 0 public, 1 private (06 §7)
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app, batch, usr, seq),
  CHECK (app > 0 AND batch > 0 AND usr > 0 AND seq > 0)
);
CREATE INDEX IF NOT EXISTS events_by_ref  ON events (ref_app, ref_batch, ref_usr, ref_seq);
CREATE INDEX IF NOT EXISTS events_by_type ON events (type_app, type_batch, type_usr, type_seq);
CREATE INDEX IF NOT EXISTS events_by_auth ON events (auth_app, auth_batch, auth_usr, auth_seq);

CREATE TABLE IF NOT EXISTS identity_counters (
  id          BIGINT PRIMARY KEY,
  batch_count BIGINT NOT NULL DEFAULT 0
);
