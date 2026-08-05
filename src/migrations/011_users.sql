-- Users table (single admin on first boot; user_id laid in now so schema never needs retrofitting)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',  -- 'admin' | 'viewer'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Personal data tables get user_id now, hardcoded to 1 until multi-user UI ships
ALTER TABLE history
  ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
UPDATE history SET user_id = 1 WHERE user_id IS NULL;

ALTER TABLE annotations
  ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
UPDATE annotations SET user_id = 1 WHERE user_id IS NULL;

-- song_tags: add user_id (keeps existing PK, user_id is additional discriminator)
ALTER TABLE song_tags
  ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
UPDATE song_tags SET user_id = 1 WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_history_user_id    ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_song_tags_user_id   ON song_tags(user_id);
