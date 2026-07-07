PRAGMA foreign_keys = ON;

CREATE TABLE oauth_states (
  state_id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  code_verifier TEXT,
  return_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_oauth_states_expires_at ON oauth_states(expires_at);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  external_account_name TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at INTEGER,
  granted_scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_refresh_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(pubkey, platform, external_account_id)
);

CREATE INDEX idx_connections_pubkey ON connections(pubkey);
CREATE INDEX idx_connections_status ON connections(status);

CREATE TABLE preferences (
  pubkey TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id TEXT,
  mode TEXT NOT NULL DEFAULT 'manual',
  automatic_enabled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(pubkey, platform),
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE TABLE auto_cursors (
  pubkey TEXT PRIMARY KEY,
  cursor TEXT,
  last_checked_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  video_event_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  source_media_url TEXT NOT NULL,
  source_media_hash TEXT NOT NULL,
  caption TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  external_post_id TEXT,
  external_post_url TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(pubkey, video_event_id, platform, external_account_id),
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_pubkey_video ON jobs(pubkey, video_event_id);
CREATE INDEX idx_jobs_status_retry ON jobs(status, next_retry_at);
CREATE INDEX idx_jobs_expires_at ON jobs(expires_at);

CREATE TABLE job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  provider_status INTEGER,
  provider_response_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_job_attempts_job_id ON job_attempts(job_id);
