-- Migration: Add sitemap URL support to scraper options
-- This migration adds sitemap URL field to enable scraping from sitemap.xml files
-- when normal crawling isn't feasible or desired

-- Add sitemap URL to scraper options JSON
-- Note: This is a logical extension; the field will be stored within the existing scraper_options JSON column
-- No schema changes needed as scraper_options is already JSON

-- This migration serves as documentation that sitemapUrl is now a supported field in scraper_options
-- The actual field will be stored as: json_extract(scraper_options, '$.sitemapUrl')

-- No data migration needed - new field defaults to null/undefined
-- Future indexing operations with sitemap support will store the sitemapUrl in scraper_options JSON
