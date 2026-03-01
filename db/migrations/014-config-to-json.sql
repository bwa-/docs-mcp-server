-- Migration 014: Move library/version configuration from SQLite to config.json
--
-- ConfigStore.initialize() exports libraries/versions data to config.json BEFORE
-- this migration runs. After migration, ConfigStore manages all library/version
-- data in config.json; the versions and libraries tables are dropped here.
--
-- Steps:
--   1. Drop all triggers that reference pages/versions/libraries.
--   2. Recreate pages WITHOUT the FK reference to versions(id).
--   3. Drop versions and libraries tables (data already in config.json).
--   4. Recreate all triggers pointing to the new pages table.
--
-- Note: foreign_keys is OFF during migration execution so we can freely
-- drop and recreate tables without constraint violations.

-- 1. Drop ALL triggers that reference pages or versions/libraries so we can safely
--    drop and recreate the pages table without trigger compilation errors.

-- documents_vec triggers (JOIN to versions/libraries - being replaced)
DROP TRIGGER IF EXISTS documents_vec_after_insert;
DROP TRIGGER IF EXISTS documents_vec_after_update;

-- FTS triggers (reference pages table - must be dropped before pages is dropped)
DROP TRIGGER IF EXISTS documents_fts_after_insert;
DROP TRIGGER IF EXISTS documents_fts_after_update;
DROP TRIGGER IF EXISTS documents_fts_after_delete;

-- pages updated_at trigger (on pages itself - drop before we drop pages)
DROP TRIGGER IF EXISTS pages_updated_at_trigger;

-- 2. Recreate pages table without the FK reference to versions.
--    All columns and the UNIQUE(version_id, url) constraint are preserved.
CREATE TABLE pages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  etag TEXT,
  last_modified TEXT,
  content_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  depth INTEGER,
  UNIQUE(version_id, url)
);

INSERT INTO pages_new SELECT * FROM pages;

DROP TABLE pages;

ALTER TABLE pages_new RENAME TO pages;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_pages_version_id ON pages(version_id);
CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
CREATE INDEX IF NOT EXISTS idx_pages_etag ON pages(etag);

-- 3. Recreate pages updated_at trigger
CREATE TRIGGER IF NOT EXISTS pages_updated_at_trigger AFTER UPDATE ON pages BEGIN
  UPDATE pages SET updated_at = CURRENT_TIMESTAMP WHERE id = new.id;
END;

-- 4. Recreate FTS triggers (unchanged from migration 009 except now on new pages table)
CREATE TRIGGER IF NOT EXISTS documents_fts_after_delete AFTER DELETE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_after_update AFTER UPDATE ON documents BEGIN
  DELETE FROM documents_fts WHERE rowid = old.id;
  INSERT INTO documents_fts(rowid, content, title, url, path)
  SELECT new.id, new.content, p.title, p.url, json_extract(new.metadata, '$.path')
  FROM pages p WHERE p.id = new.page_id;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_after_insert AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, content, title, url, path)
  SELECT new.id, new.content, p.title, p.url, json_extract(new.metadata, '$.path')
  FROM pages p WHERE p.id = new.page_id;
END;

-- 5. Re-create documents_vec insert trigger without JOIN to versions/libraries
--    Sets library_id = 0 (the column still exists but is no longer used for filtering)
CREATE TRIGGER IF NOT EXISTS documents_vec_after_insert
  AFTER INSERT ON documents
  WHEN NEW.embedding IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
  SELECT NEW.id, 0, p.version_id, json_extract(NEW.embedding, '$')
  FROM pages p
  WHERE p.id = NEW.page_id;
END;

-- 6. Re-create documents_vec update trigger without JOIN to versions/libraries
CREATE TRIGGER IF NOT EXISTS documents_vec_after_update
  AFTER UPDATE OF embedding, page_id ON documents
BEGIN
  DELETE FROM documents_vec WHERE rowid = OLD.id;
  INSERT OR REPLACE INTO documents_vec (rowid, library_id, version_id, embedding)
  SELECT NEW.id, 0, p.version_id, json_extract(NEW.embedding, '$')
  FROM pages p
  WHERE p.id = NEW.page_id AND NEW.embedding IS NOT NULL;
END;

-- 7. Drop the now-unused versions and libraries tables.
--    All data has been exported to config.json by ConfigStore before this migration ran.
--    pages.version_id is now a plain INTEGER (no FK), so these drops are safe.
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS libraries;
