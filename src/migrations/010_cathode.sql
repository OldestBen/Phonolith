CREATE TABLE IF NOT EXISTS hardware_profiles (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,                    -- e.g. "Main System"
  description   TEXT,                             -- e.g. "Chord Hugo TT2 → Sennheiser HD800S"
  device_type   TEXT NOT NULL DEFAULT 'system',  -- 'dac' | 'amp' | 'speaker' | 'headphone' | 'dap' | 'system'
  components    JSONB NOT NULL DEFAULT '[]',      -- [{role: "DAC", model: "Chord Hugo TT2"}, ...]
  total_hours   FLOAT NOT NULL DEFAULT 0,         -- accumulated playback hours
  lucid_device  TEXT,                             -- ALSA device name e.g. "hw:0,0"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE history
  ADD COLUMN IF NOT EXISTS hardware_profile_id INT REFERENCES hardware_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_history_hardware ON history(hardware_profile_id);
