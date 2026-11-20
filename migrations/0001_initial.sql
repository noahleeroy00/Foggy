
PRAGMA foreign_keys = ON;

-- ==========================================
-- FOGGY DATABASE: INITIAL PRODUCTION SCHEMA
-- ==========================================

-- 1. USER ACCOUNTS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer'
        CHECK (role IN ('customer', 'artist', 'admin')),
    account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. ARTIST ACCOUNTS
CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    artist_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    contact_phone TEXT NOT NULL,
    phone_verified INTEGER NOT NULL DEFAULT 0
        CHECK (phone_verified IN (0, 1)),
    bio TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

-- 3. MUSIC RELEASES: SINGLES AND ALBUMS
CREATE TABLE IF NOT EXISTS music (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('single', 'album')),
    album TEXT,
    genre TEXT,
    description TEXT,
    price_cents INTEGER NOT NULL
        CHECK (price_cents >= 0),
    artwork_key TEXT,

    status TEXT NOT NULL DEFAULT 'pending_verification'
        CHECK (
            status IN (
                'pending_verification',
                'published',
                'rejected',
                'removed'
            )
        ),

    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            verification_status IN (
                'pending',
                'verified',
                'rejected'
            )
        ),

    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TEXT,
    verified_by TEXT,
    admin_notes TEXT,
    rejection_reason TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (artist_id)
        REFERENCES artists(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (verified_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

-- 4. MUSIC TRACKS
CREATE TABLE IF NOT EXISTS music_tracks (
    id TEXT PRIMARY KEY,
    music_id TEXT NOT NULL,
    title TEXT NOT NULL,
    track_number INTEGER NOT NULL DEFAULT 1
        CHECK (track_number >= 1),
    audio_key TEXT NOT NULL,
    duration_seconds INTEGER,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (music_id)
        REFERENCES music(id)
        ON DELETE CASCADE
);

-- 5. CUSTOMER PURCHASES
CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    music_id TEXT NOT NULL,

    amount_cents INTEGER NOT NULL
        CHECK (amount_cents >= 0),

    platform_fee_cents INTEGER NOT NULL
        CHECK (platform_fee_cents >= 0),

    artist_amount_cents INTEGER NOT NULL
        CHECK (artist_amount_cents >= 0),

    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            payment_status IN (
                'pending',
                'paid',
                'failed',
                'refunded'
            )
        ),

    payment_provider TEXT,
    payment_reference TEXT UNIQUE,
    paid_at TEXT,
    refunded_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (customer_id)
        REFERENCES users(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (music_id)
        REFERENCES music(id)
        ON DELETE RESTRICT,

    CHECK (
        amount_cents =
        platform_fee_cents + artist_amount_cents
    )
);

-- 6. CUSTOMER MUSIC LIBRARY
CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    music_id TEXT NOT NULL,
    purchase_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(customer_id, music_id),

    FOREIGN KEY (customer_id)
        REFERENCES users(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (music_id)
        REFERENCES music(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (purchase_id)
        REFERENCES purchases(id)
        ON DELETE RESTRICT
);

-- 7. LOGIN SESSIONS
-- Only hashed session tokens will be stored.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- 8. RELEASE VERIFICATION HISTORY
CREATE TABLE IF NOT EXISTS release_verifications (
    id TEXT PRIMARY KEY,
    music_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,

    action TEXT NOT NULL
        CHECK (
            action IN (
                'approved',
                'rejected',
                'deleted',
                'restored'
            )
        ),

    contact_method TEXT,
    contact_outcome TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (music_id)
        REFERENCES music(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (admin_id)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

-- 9. ADMIN AUDIT LOG
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (admin_id)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

-- 10. PAYMENT WEBHOOK EVENT RECORDS
-- Supports idempotency and prevents duplicate payment processing.
CREATE TABLE IF NOT EXISTS payment_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    purchase_id TEXT,
    event_type TEXT NOT NULL,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(provider, provider_event_id),

    FOREIGN KEY (purchase_id)
        REFERENCES purchases(id)
        ON DELETE RESTRICT
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_music_status
ON music(status);

CREATE INDEX IF NOT EXISTS idx_music_type
ON music(type);

CREATE INDEX IF NOT EXISTS idx_music_artist
ON music(artist_id);

CREATE INDEX IF NOT EXISTS idx_music_created
ON music(created_at);

CREATE INDEX IF NOT EXISTS idx_tracks_music
ON music_tracks(music_id);

CREATE INDEX IF NOT EXISTS idx_purchases_customer
ON purchases(customer_id);

CREATE INDEX IF NOT EXISTS idx_purchases_music
ON purchases(music_id);

CREATE INDEX IF NOT EXISTS idx_purchases_status
ON purchases(payment_status);

CREATE INDEX IF NOT EXISTS idx_library_customer
ON library_items(customer_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_verifications_music
ON release_verifications(music_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
ON admin_audit_logs(created_at);

-- ==========================================
-- SALES CHART VIEW
-- All releases are included, even those with
-- zero sales. Only paid purchases count.
-- ==========================================

CREATE VIEW IF NOT EXISTS music_sales AS
SELECT
    m.id AS music_id,
    m.type,
    m.title,
    m.artist_id,
    m.status,
    COUNT(p.id) AS total_sales
FROM music m
LEFT JOIN purchases p
    ON p.music_id = m.id
    AND p.payment_status = 'paid'
GROUP BY m.id;

-- ==========================================
-- END OF FOGGY INITIAL DATABASE SCHEMA
-- ==========================================
