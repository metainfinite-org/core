-- The default IDM's private tables (03 §2, §8; 07 §5 custody). Not part of the
-- log and not rebuilt by replay: they are the IDM's own records.

CREATE TABLE IF NOT EXISTS idm_accounts (
  subject   TEXT PRIMARY KEY,          -- "dev:alice", or an OIDC issuer + sub
  identity  BIGINT NOT NULL UNIQUE,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idm_custody (
  identity  BIGINT NOT NULL,           -- an identity the IDM owns, e.g. an app
  human     BIGINT NOT NULL,           -- an account allowed to control it
  role      TEXT NOT NULL,
  PRIMARY KEY (identity, human)
);

CREATE INDEX IF NOT EXISTS idm_custody_by_human ON idm_custody (human);
