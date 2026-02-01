/**
 * Sitemap parsing utilities for extracting URLs from XML sitemap files.
 * Supports both regular sitemaps and sitemap index files.
 */

import { parseStringPromise } from "xml2js";
import { logger } from "../../utils/logger";
import type { QueueItem } from "../types";

/**
 * Parsed sitemap structure
 */
interface SitemapUrl {
  loc: string[];
  lastmod?: string[];
  priority?: string[];
}

interface Sitemap {
  urlset?: {
    url?: SitemapUrl[];
  };
  sitemapindex?: {
    sitemap?: Array<{ loc: string[] }>;
  };
}

/**
 * Fetches and parses a sitemap XML file, extracting all URLs.
 * Handles both regular sitemaps and sitemap index files recursively.
 *
 * @param sitemapUrl - The URL of the sitemap.xml file
 * @param fetcher - Function to fetch content from URLs (accepts URL and optional headers)
 * @param headers - Optional HTTP headers for authentication
 * @param visitedSitemaps - Set of already visited sitemap URLs to prevent infinite loops
 * @returns Array of QueueItems with URLs and depth 0
 */
export async function parseSitemap(
  sitemapUrl: string,
  fetcher: (
    url: string,
    options?: { headers?: Record<string, string> },
  ) => Promise<string>,
  headers?: Record<string, string>,
  visitedSitemaps: Set<string> = new Set(),
): Promise<QueueItem[]> {
  // Prevent infinite loops in sitemap indexes
  if (visitedSitemaps.has(sitemapUrl)) {
    logger.warn(`⚠️  Skipping already visited sitemap: ${sitemapUrl}`);
    return [];
  }
  visitedSitemaps.add(sitemapUrl);

  try {
    logger.debug(`Fetching sitemap from ${sitemapUrl}`);
    const xmlContent = await fetcher(sitemapUrl, { headers });

    // Parse XML content
    const parsed = (await parseStringPromise(xmlContent, {
      trim: true,
      explicitArray: true,
    })) as Sitemap;

    // Check if this is a sitemap index
    if (parsed.sitemapindex?.sitemap) {
      logger.info(
        `📋 Found sitemap index with ${parsed.sitemapindex.sitemap.length} sitemaps`,
      );
      const allUrls: QueueItem[] = [];

      // Recursively parse all referenced sitemaps
      for (const sitemap of parsed.sitemapindex.sitemap) {
        if (sitemap.loc?.[0]) {
          const childSitemapUrl = sitemap.loc[0];
          logger.debug(`Parsing child sitemap: ${childSitemapUrl}`);
          const childUrls = await parseSitemap(
            childSitemapUrl,
            fetcher,
            headers,
            visitedSitemaps,
          );
          allUrls.push(...childUrls);
        }
      }

      return allUrls;
    }

    // Regular sitemap with URLs
    if (parsed.urlset?.url) {
      const urls = parsed.urlset.url
        .filter((entry) => entry.loc?.[0])
        .map((entry) => ({
          url: entry.loc[0],
          depth: 0, // All sitemap URLs start at depth 0
        }));

      logger.info(`📄 Extracted ${urls.length} URLs from sitemap`);
      return urls;
    }

    logger.warn(`⚠️  No URLs found in sitemap: ${sitemapUrl}`);
    return [];
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Failed to parse sitemap ${sitemapUrl}: ${errorMsg}`);
    throw new Error(`Failed to parse sitemap: ${errorMsg}`);
  }
}

/**
 * Validates that a URL points to a sitemap file (basic check).
 * @param url - The URL to validate
 * @returns true if the URL appears to be a sitemap
 */
export function isSitemapUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.endsWith(".xml") || pathname.includes("sitemap");
  } catch {
    return false;
  }
}
