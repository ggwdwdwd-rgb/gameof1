CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE devices (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id),
  identity_public_key   TEXT NOT NULL,
  encryption_public_key TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  revoked_at            INTEGER
);

CREATE INDEX idx_devices_user_id ON devices(user_id);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  used_by     TEXT REFERENCES users(id)
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  client_msg_id   TEXT NOT NULL,
  chat_id         TEXT NOT NULL,
  from_user_id    TEXT NOT NULL REFERENCES users(id),
  from_device_id  TEXT NOT NULL REFERENCES devices(id),
  content_type    TEXT NOT NULL,
  ciphertext      BLOB NOT NULL,
  nonce           BLOB NOT NULL,
  reply_to        TEXT,
  created_at      INTEGER NOT NULL,
  ttl_expires_at  INTEGER NOT NULL,
  deleted_at      INTEGER
);

CREATE INDEX idx_messages_chat_id ON messages(chat_id, created_at);
CREATE UNIQUE INDEX idx_messages_client_msg_id ON messages(from_device_id, client_msg_id);

CREATE TABLE message_receipts (
  msg_id      TEXT NOT NULL REFERENCES messages(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (msg_id, user_id)
);

CREATE TABLE group_key_versions (
  chat_id       TEXT NOT NULL,
  key_version   INTEGER NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (chat_id, key_version)
);
