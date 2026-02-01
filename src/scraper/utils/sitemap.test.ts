/**
 * Tests for sitemap parsing utilities
 */
import { describe, expect, it, vi } from "vitest";
import { isSitemapUrl, parseSitemap } from "./sitemap";

describe("sitemap utilities", () => {
  describe("isSitemapUrl", () => {
    it("should return true for URLs ending with .xml", () => {
      expect(isSitemapUrl("https://example.com/sitemap.xml")).toBe(true);
      expect(isSitemapUrl("https://example.com/docs/sitemap.xml")).toBe(true);
    });

    it("should return true for URLs containing 'sitemap'", () => {
      expect(isSitemapUrl("https://example.com/sitemap")).toBe(true);
      expect(isSitemapUrl("https://example.com/sitemap-index")).toBe(true);
    });

    it("should return false for non-sitemap URLs", () => {
      expect(isSitemapUrl("https://example.com/page.html")).toBe(false);
      expect(isSitemapUrl("https://example.com/docs")).toBe(false);
    });

    it("should return false for invalid URLs", () => {
      expect(isSitemapUrl("not-a-url")).toBe(false);
    });
  });

  describe("parseSitemap", () => {
    it("should parse a regular sitemap with URLs", async () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1</loc>
    <lastmod>2024-01-01</lastmod>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
  </url>
  <url>
    <loc>https://example.com/page3</loc>
    <priority>0.8</priority>
  </url>
</urlset>`;

      const fetcher = vi.fn().mockResolvedValue(xmlContent);
      const result = await parseSitemap("https://example.com/sitemap.xml", fetcher);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ url: "https://example.com/page1", depth: 0 });
      expect(result[1]).toEqual({ url: "https://example.com/page2", depth: 0 });
      expect(result[2]).toEqual({ url: "https://example.com/page3", depth: 0 });
      expect(fetcher).toHaveBeenCalledWith("https://example.com/sitemap.xml", {
        headers: undefined,
      });
    });

    it("should parse a sitemap index and recursively fetch child sitemaps", async () => {
      const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap1.xml</loc>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap2.xml</loc>
  </sitemap>
</sitemapindex>`;

      const sitemap1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page1</loc></url>
  <url><loc>https://example.com/page2</loc></url>
</urlset>`;

      const sitemap2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page3</loc></url>
</urlset>`;

      const fetcher = vi.fn().mockImplementation((url: string) => {
        if (url === "https://example.com/sitemap.xml") return Promise.resolve(indexXml);
        if (url === "https://example.com/sitemap1.xml")
          return Promise.resolve(sitemap1Xml);
        if (url === "https://example.com/sitemap2.xml")
          return Promise.resolve(sitemap2Xml);
        return Promise.reject(new Error("Unexpected URL"));
      });

      const result = await parseSitemap("https://example.com/sitemap.xml", fetcher);

      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { url: "https://example.com/page1", depth: 0 },
        { url: "https://example.com/page2", depth: 0 },
        { url: "https://example.com/page3", depth: 0 },
      ]);
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("should handle empty sitemaps", async () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`;

      const fetcher = vi.fn().mockResolvedValue(xmlContent);
      const result = await parseSitemap("https://example.com/sitemap.xml", fetcher);

      expect(result).toEqual([]);
    });

    it("should filter out entries without loc tags", async () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1</loc>
  </url>
  <url>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
  </url>
</urlset>`;

      const fetcher = vi.fn().mockResolvedValue(xmlContent);
      const result = await parseSitemap("https://example.com/sitemap.xml", fetcher);

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { url: "https://example.com/page1", depth: 0 },
        { url: "https://example.com/page2", depth: 0 },
      ]);
    });

    it("should pass custom headers to the fetcher", async () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page1</loc></url>
</urlset>`;

      const fetcher = vi.fn().mockResolvedValue(xmlContent);
      const headers = { Authorization: "Bearer token123" };

      await parseSitemap("https://example.com/sitemap.xml", fetcher, headers);

      expect(fetcher).toHaveBeenCalledWith("https://example.com/sitemap.xml", {
        headers,
      });
    });

    it("should prevent infinite loops in sitemap indexes", async () => {
      const circularIndexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap.xml</loc>
  </sitemap>
</sitemapindex>`;

      const fetcher = vi.fn().mockResolvedValue(circularIndexXml);

      const result = await parseSitemap("https://example.com/sitemap.xml", fetcher);

      // Should only fetch once, then detect circular reference
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
    });

    it("should throw error for invalid XML", async () => {
      const invalidXml = "This is not valid XML";
      const fetcher = vi.fn().mockResolvedValue(invalidXml);

      await expect(
        parseSitemap("https://example.com/sitemap.xml", fetcher),
      ).rejects.toThrow("Failed to parse sitemap");
    });

    it("should throw error when fetcher fails", async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(
        parseSitemap("https://example.com/sitemap.xml", fetcher),
      ).rejects.toThrow("Failed to parse sitemap: Network error");
    });
  });
});
