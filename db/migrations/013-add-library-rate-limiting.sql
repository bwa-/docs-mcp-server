-- Migration: Add rate limiting configuration to libraries table
-- This allows setting per-library rate limiting defaults that apply to all scraping jobs

-- Add rate limiting columns to libraries table
ALTER TABLE libraries ADD COLUMN delay_between_pages_ms INTEGER DEFAULT 0;
ALTER TABLE libraries ADD COLUMN max_retries INTEGER DEFAULT NULL; -- NULL = use global default

-- Add comment column for library notes/description
ALTER TABLE libraries ADD COLUMN description TEXT DEFAULT NULL;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_libraries_delay ON libraries(delay_between_pages_ms);

-- Note: Existing libraries will use default values (no delay, global retry limit)
-- These can be updated per-library as needed for sites with strict rate limiting
