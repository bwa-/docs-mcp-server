/**
 * SuggestLibrariesTool - Intelligent library relevance ranking
 *
 * Purpose:
 * Helps users discover which libraries are most relevant to their query by performing
 * parallel lightweight searches across all indexed libraries and ranking results by
 * relevance score.
 *
 * Key Logic:
 * 1. Fetches all indexed libraries from document store
 * 2. Executes parallel search queries (3 results max per library for speed)
 * 3. Calculates relevance score (max score from top results)
 * 4. Filters zero-score libraries and sorts by descending relevance
 * 5. Returns top N libraries with scores and matched content snippets
 *
 * Use Cases:
 * - AI agent initialization: discover relevant docs before deep search
 * - Workflow optimization: reduce search scope from 19+ libraries to ~5
 * - Context size management: avoid loading irrelevant documentation
 *
 * Performance:
 * - Parallel search: O(N) with N = number of indexed libraries
 * - Low result limit (3 per library) keeps queries fast
 * - No blocking: errors in individual libraries don't fail entire operation
 */
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { logger } from "../utils/logger";
import { ValidationError } from "./errors";

export interface SuggestLibrariesOptions {
  query: string;
  maxLibraries?: number;
}

export interface LibrarySuggestion {
  name: string;
  score: number;
  matchedContent?: string;
}

export interface SuggestLibrariesResult {
  libraries: LibrarySuggestion[];
}

/**
 * Tool for suggesting relevant libraries based on a query.
 * Performs lightweight searches across all indexed libraries and ranks them by relevance.
 */
export class SuggestLibrariesTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: SuggestLibrariesOptions): Promise<SuggestLibrariesResult> {
    const { query, maxLibraries = 5 } = options;

    // Validate inputs
    if (!query || typeof query !== "string" || query.trim() === "") {
      throw new ValidationError(
        "Query is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (
      maxLibraries !== undefined &&
      (typeof maxLibraries !== "number" || maxLibraries < 1 || maxLibraries > 20)
    ) {
      throw new ValidationError(
        "maxLibraries must be a number between 1 and 20.",
        this.constructor.name,
      );
    }

    logger.info(`🔍 Suggesting libraries for query: "${query}"`);

    // Get all indexed libraries
    const allLibraries = await this.docService.listLibraries();

    if (allLibraries.length === 0) {
      logger.warn("⚠️  No libraries indexed yet.");
      return { libraries: [] };
    }

    logger.debug(`📚 Evaluating ${allLibraries.length} libraries`);

    // Search each library in parallel with low limit for speed
    const searchPromises = allLibraries.map(async (lib) => {
      try {
        // Search without version constraint to check all available versions
        const results = await this.docService.searchStore(
          lib.library,
          undefined,
          query,
          3,
        );

        if (results.length === 0) {
          return { name: lib.library, score: 0 };
        }

        // Calculate max score from top results (filter out null scores)
        const scores = results.map((r) => r.score).filter((s): s is number => s !== null);
        const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

        if (maxScore === 0) {
          return { name: lib.library, score: 0 };
        }

        // Extract a short snippet from the best match
        const topResult = results.reduce((best, current) => {
          const currentScore = current.score ?? 0;
          const bestScore = best.score ?? 0;
          return currentScore > bestScore ? current : best;
        });
        const matchedContent = topResult.content?.substring(0, 200);

        return {
          name: lib.library,
          score: maxScore,
          matchedContent,
        };
      } catch (error) {
        // Library might not have valid versions or searchable content
        logger.debug(
          `Skipping ${lib.library}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
        return { name: lib.library, score: 0 };
      }
    });

    const scoredLibraries = await Promise.all(searchPromises);

    // Filter out zero scores and sort by relevance
    const rankedLibraries = scoredLibraries
      .filter((lib) => lib.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLibraries);

    logger.info(
      `✅ Found ${rankedLibraries.length} relevant libraries (from ${allLibraries.length} total)`,
    );

    return { libraries: rankedLibraries };
  }
}
