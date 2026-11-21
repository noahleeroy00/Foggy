
PRAGMA foreign_keys = ON;

-- 1. UPLOAD SESSION TRACKING
CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    purpose TEXT NOT NULL
        CHECK (purpose IN ('audio', 'artwork')),
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL
        CHECK (file_size_bytes > 0),
    object_key TEXT NOT NULL UNIQUE,
    multipart_upload_id TEXT,
    status TEXT NOT NULL DEFAULT 'initiated'
        CHECK (
            status IN (
                'initiated',
                'uploading',
                'completed',
                'processing',
                'ready',
                'attached',
                'failed',
                'expired',
                'aborted'
            )
        ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    completed_at TEXT,
    attached_at TEXT,
    FOREIGN KEY (artist_id)
        REFERENCES artists(id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_artist
ON upload_sessions(artist_id);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_status
ON upload_sessions(status);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_expiry
ON upload_sessions(expires_at);

-- 2. ORIGINAL WAV MASTER INFORMATION
-- Original WAV masters are retained while releases remain available.
-- No automatic 12-month deletion.

ALTER TABLE music_tracks
ADD COLUMN original_audio_key TEXT;

ALTER TABLE music_tracks
ADD COLUMN original_audio_deleted_at TEXT;

ALTER TABLE music_tracks
ADD COLUMN audio_processing_status TEXT
NOT NULL DEFAULT 'pending'
CHECK (
    audio_processing_status IN (
        'pending',
        'processing',
        'ready',
        'failed'
    )
);
