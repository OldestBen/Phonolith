# NATS JetStream topic constants — shared across all Python services.
# Rust services use string literals matching these values.

# ── Streams ──────────────────────────────────────────────────────────────────

STREAM_FS        = "PHONOLITH_FS"
STREAM_HASH      = "PHONOLITH_HASH"
STREAM_METADATA  = "PHONOLITH_METADATA"
STREAM_ANALYSIS  = "PHONOLITH_ANALYSIS"
STREAM_VAULT     = "PHONOLITH_VAULT"
STREAM_PLAYBACK  = "PHONOLITH_PLAYBACK"
STREAM_ANALYTICS = "PHONOLITH_ANALYTICS"

# ── Topics: Tremor → Bit-Forge ────────────────────────────────────────────────

FS_CREATED  = "phonolith.fs.created"
FS_MODIFIED = "phonolith.fs.modified"
FS_DELETED  = "phonolith.fs.deleted"
FS_RENAMED  = "phonolith.fs.renamed"

# ── Topics: Bit-Forge → Engram / Lexicon / Prism / Crest ─────────────────────

HASH_CREATED  = "phonolith.hash.created"
HASH_MODIFIED = "phonolith.hash.modified"
HASH_DELETED  = "phonolith.hash.deleted"
HASH_RENAMED  = "phonolith.hash.renamed"

# ── Topics: Engram ────────────────────────────────────────────────────────────

METADATA_SNAPSHOT  = "phonolith.metadata.snapshot"   # initial tag capture
METADATA_ENRICHED  = "phonolith.metadata.enriched"   # after Lexicon enrichment
METADATA_RESTORED  = "phonolith.metadata.restored"   # after a restore-point rollback

# ── Topics: Prism ─────────────────────────────────────────────────────────────

ANALYSIS_PRISM    = "phonolith.analysis.prism"    # spectral + fraud result
ANALYSIS_CREST    = "phonolith.analysis.crest"    # DR score result
ANALYSIS_ACOUSTIC = "phonolith.analysis.acoustic" # BPM/key/mood/embedding

# ── Topics: Aegis ─────────────────────────────────────────────────────────────

VAULT_QUEUED    = "phonolith.vault.queued"
VAULT_UPLOADED  = "phonolith.vault.uploaded"
VAULT_VERIFIED  = "phonolith.vault.verified"
VAULT_RESTORED  = "phonolith.vault.restored"

# ── Topics: Lucid / Flux ──────────────────────────────────────────────────────

PLAYBACK_STARTED  = "phonolith.playback.started"
PLAYBACK_STOPPED  = "phonolith.playback.stopped"
PLAYBACK_PROGRESS = "phonolith.playback.progress"
PLAYBACK_SIGNAL   = "phonolith.playback.signal"    # signal path state update

# ── Topics: EchoGraph ────────────────────────────────────────────────────────

ANALYTICS_PLAY_EVENT   = "phonolith.analytics.play"
ANALYTICS_SCROBBLE     = "phonolith.analytics.scrobble"
