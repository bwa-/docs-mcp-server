import fs from "node:fs";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { logger } from "../utils/logger";
import type { StoredScraperOptions, VersionScraperOptions } from "./types";
import { VersionStatus } from "./types";

/**
 * Library configuration stored in config.json.
 * Replaces the SQLite `libraries` table.
 */
export interface LibraryConfig {
  id: number;
  /** Normalized to lowercase */
  name: string;
  description: string | null;
  delayBetweenPagesMs: number;
  maxRetries: number | null;
}

/**
 * Version configuration stored in config.json.
 * Replaces the SQLite `versions` table.
 */
export interface VersionConfig {
  id: number;
  libraryId: number;
  /** Normalized to lowercase; empty string for unversioned content */
  name: string;
  status: VersionStatus;
  progressPages: number;
  progressMaxPages: number;
  errorMessage: string | null;
  startedAt: string | null;
  updatedAt: string;
  createdAt: string;
  /** Original scraping URL used to index this version */
  sourceUrl: string | null;
  /** JSON-encoded VersionScraperOptions */
  scraperOptions: string | null;
}

interface ConfigData {
  libraries: LibraryConfig[];
  versions: VersionConfig[];
  nextLibraryId: number;
  nextVersionId: number;
}

/**
 * Manages library and version configuration as a JSON file.
 *
 * Replaces the SQLite `libraries` and `versions` tables, allowing the documents.db
 * file to be gitignored while this config.json remains version-controllable.
 *
 * Supports `:memory:` mode (for testing) where no file I/O is performed.
 */
export class ConfigStore {
  private readonly configPath: string;
  private readonly inMemory: boolean;
  private data: ConfigData;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.inMemory = configPath === ":memory:";
    this.data = {
      libraries: [],
      versions: [],
      nextLibraryId: 1,
      nextVersionId: 1,
    };
  }

  /**
   * Initializes the config store.
   *
   * If a config file already exists, loads it.
   * If not, attempts to migrate from the provided SQLite database (for existing users upgrading).
   * Must be called BEFORE SQLite migration 014 runs, since that migration drops the
   * versions/libraries tables.
   *
   * @param db Optional SQLite database instance for legacy data migration
   */
  initialize(db?: DatabaseType): void {
    if (!this.inMemory && fs.existsSync(this.configPath)) {
      this.loadFromFile();
      return;
    }

    // No config file yet - attempt SQLite migration for existing users
    if (db && this.hasSQLiteTables(db)) {
      logger.info("📦 Migrating library configuration from SQLite to config.json...");
      this.migrateFromSQLite(db);
      logger.info(
        `✅ Migrated ${this.data.libraries.length} libraries and ${this.data.versions.length} versions to config.json`,
      );
    }

    if (!this.inMemory) {
      this.saveToFile();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private loadFromFile(): void {
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      this.data = JSON.parse(content) as ConfigData;
    } catch (error) {
      logger.warn(
        `⚠️  Failed to load config from ${this.configPath}: ${error}. Starting fresh.`,
      );
      this.data = { libraries: [], versions: [], nextLibraryId: 1, nextVersionId: 1 };
    }
  }

  private saveToFile(): void {
    if (this.inMemory) return;
    try {
      const dir = path.dirname(this.configPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (error) {
      logger.error(`❌ Failed to save config to ${this.configPath}: ${error}`);
    }
  }

  private hasSQLiteTables(db: DatabaseType): boolean {
    try {
      const result = db
        .prepare(
          `SELECT COUNT(*) as count FROM sqlite_master
           WHERE type = 'table' AND name IN ('libraries', 'versions')`,
        )
        .get() as { count: number };
      return result.count >= 2;
    } catch {
      return false;
    }
  }

  private migrateFromSQLite(db: DatabaseType): void {
    try {
      const libraries = db.prepare("SELECT * FROM libraries").all() as Array<{
        id: number;
        name: string;
        description: string | null;
        delay_between_pages_ms: number | null;
        max_retries: number | null;
      }>;

      const versions = db.prepare("SELECT * FROM versions").all() as Array<{
        id: number;
        library_id: number;
        name: string | null;
        status: string;
        progress_pages: number;
        progress_max_pages: number;
        error_message: string | null;
        started_at: string | null;
        updated_at: string;
        created_at: string;
        source_url: string | null;
        scraper_options: string | null;
      }>;

      this.data.libraries = libraries.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        delayBetweenPagesMs: l.delay_between_pages_ms ?? 0,
        maxRetries: l.max_retries,
      }));

      this.data.versions = versions.map((v) => ({
        id: v.id,
        libraryId: v.library_id,
        name: v.name ?? "",
        status: v.status as VersionStatus,
        progressPages: v.progress_pages,
        progressMaxPages: v.progress_max_pages,
        errorMessage: v.error_message,
        startedAt: v.started_at,
        updatedAt: v.updated_at,
        createdAt: v.created_at,
        sourceUrl: v.source_url,
        scraperOptions: v.scraper_options,
      }));

      // Set next IDs to avoid conflicts with existing records
      const maxLibraryId = this.data.libraries.reduce((m, l) => Math.max(m, l.id), 0);
      const maxVersionId = this.data.versions.reduce((m, v) => Math.max(m, v.id), 0);
      this.data.nextLibraryId = maxLibraryId + 1;
      this.data.nextVersionId = maxVersionId + 1;
    } catch (error) {
      logger.warn(
        `⚠️  Failed to migrate SQLite data: ${error}. Starting with empty config.`,
      );
      this.data = { libraries: [], versions: [], nextLibraryId: 1, nextVersionId: 1 };
    }
  }

  // ---------------------------------------------------------------------------
  // Library management
  // ---------------------------------------------------------------------------

  /**
   * Ensures a library exists and returns its ID. Creates it if not found.
   */
  ensureLibrary(name: string): number {
    const normalized = name.toLowerCase();
    const existing = this.data.libraries.find((l) => l.name === normalized);
    if (existing) return existing.id;

    const id = this.data.nextLibraryId++;
    this.data.libraries.push({
      id,
      name: normalized,
      description: null,
      delayBetweenPagesMs: 0,
      maxRetries: null,
    });
    this.saveToFile();
    return id;
  }

  getLibraryByName(name: string): LibraryConfig | null {
    return this.data.libraries.find((l) => l.name === name.toLowerCase()) ?? null;
  }

  getLibraryById(id: number): LibraryConfig | null {
    return this.data.libraries.find((l) => l.id === id) ?? null;
  }

  getAllLibraries(): LibraryConfig[] {
    return [...this.data.libraries];
  }

  /**
   * Gets rate-limiting settings for a specific library.
   * Returns null if the library doesn't exist.
   */
  getLibrarySettings(library: string): {
    delayBetweenPagesMs: number;
    maxRetries: number | null;
    description: string | null;
  } | null {
    const lib = this.getLibraryByName(library);
    if (!lib) return null;
    return {
      delayBetweenPagesMs: lib.delayBetweenPagesMs,
      maxRetries: lib.maxRetries,
      description: lib.description,
    };
  }

  /**
   * Updates rate-limiting settings for a library, creating it if it doesn't exist.
   */
  updateLibrarySettings(
    library: string,
    settings: {
      delayBetweenPagesMs?: number;
      maxRetries?: number | null;
      description?: string | null;
    },
  ): void {
    this.ensureLibrary(library);
    const lib = this.getLibraryByName(library)!;

    if (settings.delayBetweenPagesMs !== undefined) {
      lib.delayBetweenPagesMs = settings.delayBetweenPagesMs;
    }
    if (settings.maxRetries !== undefined) {
      lib.maxRetries = settings.maxRetries;
    }
    if (settings.description !== undefined) {
      lib.description = settings.description;
    }
    this.saveToFile();
  }

  deleteLibrary(libraryId: number): void {
    this.data.libraries = this.data.libraries.filter((l) => l.id !== libraryId);
    this.data.versions = this.data.versions.filter((v) => v.libraryId !== libraryId);
    this.saveToFile();
  }

  // ---------------------------------------------------------------------------
  // Version management
  // ---------------------------------------------------------------------------

  /**
   * Ensures a version exists for a given library ID and returns its ID.
   * Creates it with NOT_INDEXED status if not found.
   */
  ensureVersion(libraryId: number, versionName: string): number {
    const normalized = versionName.toLowerCase();
    const existing = this.data.versions.find(
      (v) => v.libraryId === libraryId && v.name === normalized,
    );
    if (existing) return existing.id;

    const id = this.data.nextVersionId++;
    const now = new Date().toISOString();
    this.data.versions.push({
      id,
      libraryId,
      name: normalized,
      status: VersionStatus.NOT_INDEXED,
      progressPages: 0,
      progressMaxPages: 0,
      errorMessage: null,
      startedAt: null,
      updatedAt: now,
      createdAt: now,
      sourceUrl: null,
      scraperOptions: null,
    });
    this.saveToFile();
    return id;
  }

  /**
   * Resolves a (library name, version name) pair to a version ID, creating both if needed.
   */
  resolveVersion(library: string, version: string): number {
    const libraryId = this.ensureLibrary(library);
    return this.ensureVersion(libraryId, version);
  }

  /**
   * Returns the version ID for the given library/version, or null if not found.
   */
  getVersionId(library: string, version: string): number | null {
    const lib = this.getLibraryByName(library);
    if (!lib) return null;
    const normalized = version.toLowerCase();
    const ver = this.data.versions.find(
      (v) => v.libraryId === lib.id && v.name === normalized,
    );
    return ver?.id ?? null;
  }

  getVersionById(id: number): VersionConfig | null {
    return this.data.versions.find((v) => v.id === id) ?? null;
  }

  getVersionsForLibrary(libraryId: number): VersionConfig[] {
    return this.data.versions.filter((v) => v.libraryId === libraryId);
  }

  countVersionsForLibrary(libraryId: number): number {
    return this.data.versions.filter((v) => v.libraryId === libraryId).length;
  }

  /**
   * Returns all distinct version names for a library (empty string = unversioned).
   */
  getUniqueVersionNames(library: string): string[] {
    const lib = this.getLibraryByName(library);
    if (!lib) return [];
    return this.data.versions.filter((v) => v.libraryId === lib.id).map((v) => v.name);
  }

  getVersionsByStatus(
    statuses: VersionStatus[],
  ): (VersionConfig & { libraryName: string })[] {
    return this.data.versions
      .filter((v) => statuses.includes(v.status))
      .map((v) => ({
        ...v,
        libraryName: this.getLibraryById(v.libraryId)?.name ?? "",
      }));
  }

  findVersionsBySourceUrl(url: string): (VersionConfig & { libraryName: string })[] {
    return this.data.versions
      .filter((v) => v.sourceUrl === url)
      .map((v) => ({
        ...v,
        libraryName: this.getLibraryById(v.libraryId)?.name ?? "",
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  updateVersionStatus(
    versionId: number,
    status: VersionStatus,
    errorMessage?: string,
  ): void {
    const ver = this.data.versions.find((v) => v.id === versionId);
    if (!ver) return;
    ver.status = status;
    ver.errorMessage = errorMessage ?? null;
    ver.updatedAt = new Date().toISOString();
    this.saveToFile();
  }

  updateVersionProgress(versionId: number, pages: number, maxPages: number): void {
    const ver = this.data.versions.find((v) => v.id === versionId);
    if (!ver) return;
    ver.progressPages = pages;
    ver.progressMaxPages = maxPages;
    ver.updatedAt = new Date().toISOString();
    this.saveToFile();
  }

  storeScraperOptions(
    versionId: number,
    sourceUrl: string,
    scraperOptionsJson: string,
  ): void {
    const ver = this.data.versions.find((v) => v.id === versionId);
    if (!ver) return;
    ver.sourceUrl = sourceUrl;
    ver.scraperOptions = scraperOptionsJson;
    ver.updatedAt = new Date().toISOString();
    this.saveToFile();
  }

  getScraperOptions(versionId: number): StoredScraperOptions | null {
    const ver = this.data.versions.find((v) => v.id === versionId);
    if (!ver?.sourceUrl) return null;

    let parsed: VersionScraperOptions = {} as VersionScraperOptions;
    if (ver.scraperOptions) {
      try {
        parsed = JSON.parse(ver.scraperOptions) as VersionScraperOptions;
      } catch (e) {
        logger.warn(`⚠️  Invalid scraper_options JSON for version ${versionId}: ${e}`);
        parsed = {} as VersionScraperOptions;
      }
    }
    return { sourceUrl: ver.sourceUrl, options: parsed };
  }

  deleteVersion(versionId: number): void {
    this.data.versions = this.data.versions.filter((v) => v.id !== versionId);
    this.saveToFile();
  }
}
