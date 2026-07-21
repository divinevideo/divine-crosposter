CREATE TABLE oauth_attempts (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_code TEXT,
  provider_status INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_attempts_status_expires ON oauth_attempts(status, expires_at);
CREATE INDEX idx_oauth_attempts_platform_updated ON oauth_attempts(platform, updated_at);
