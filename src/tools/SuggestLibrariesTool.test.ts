import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { LibrarySummary, StoreSearchResult } from "../store/types";
import { ValidationError } from "./errors";
import { SuggestLibrariesTool } from "./SuggestLibrariesTool";

describe("SuggestLibrariesTool", () => {
  let mockDocService: IDocumentManagement;
  let tool: SuggestLibrariesTool;

  beforeEach(() => {
    mockDocService = {
      listLibraries: vi.fn(),
      searchStore: vi.fn(),
    } as unknown as IDocumentManagement;

    tool = new SuggestLibrariesTool(mockDocService);
  });

  describe("execute", () => {
    it("should validate query parameter", async () => {
      await expect(tool.execute({ query: "" })).rejects.toThrow(ValidationError);
      await expect(tool.execute({ query: "   " })).rejects.toThrow(ValidationError);
    });

    it("should validate maxLibraries parameter", async () => {
      await expect(tool.execute({ query: "test", maxLibraries: 0 })).rejects.toThrow(
        ValidationError,
      );
      await expect(tool.execute({ query: "test", maxLibraries: 21 })).rejects.toThrow(
        ValidationError,
      );
    });

    it("should return empty array when no libraries are indexed", async () => {
      vi.mocked(mockDocService.listLibraries).mockResolvedValue([]);

      const result = await tool.execute({ query: "test query" });

      expect(result.libraries).toEqual([]);
    });

    it("should suggest relevant libraries based on search scores", async () => {
      const mockLibraries: LibrarySummary[] = [
        { library: "react", versions: [] },
        { library: "vue", versions: [] },
        { library: "angular", versions: [] },
      ];

      const mockSearchResults: Record<string, StoreSearchResult[]> = {
        react: [{ content: "React hooks documentation", score: 0.95, url: "" }],
        vue: [{ content: "Vue composition API", score: 0.75, url: "" }],
        angular: [],
      };

      vi.mocked(mockDocService.listLibraries).mockResolvedValue(mockLibraries);
      vi.mocked(mockDocService.searchStore).mockImplementation(
        async (library: string) => mockSearchResults[library] || [],
      );

      const result = await tool.execute({ query: "hooks", maxLibraries: 5 });

      expect(result.libraries).toHaveLength(2);
      expect(result.libraries[0].name).toBe("react");
      expect(result.libraries[0].score).toBe(0.95);
      expect(result.libraries[1].name).toBe("vue");
      expect(result.libraries[1].score).toBe(0.75);
    });

    it("should limit results to maxLibraries", async () => {
      const mockLibraries: LibrarySummary[] = [
        { library: "lib1", versions: [] },
        { library: "lib2", versions: [] },
        { library: "lib3", versions: [] },
      ];

      vi.mocked(mockDocService.listLibraries).mockResolvedValue(mockLibraries);
      vi.mocked(mockDocService.searchStore).mockResolvedValue([
        { content: "match", score: 0.8, url: "" },
      ]);

      const result = await tool.execute({ query: "test", maxLibraries: 2 });

      expect(result.libraries).toHaveLength(2);
    });

    it("should handle search errors gracefully", async () => {
      const mockLibraries: LibrarySummary[] = [
        { library: "good-lib", versions: [] },
        { library: "bad-lib", versions: [] },
      ];

      vi.mocked(mockDocService.listLibraries).mockResolvedValue(mockLibraries);
      vi.mocked(mockDocService.searchStore).mockImplementation(
        async (library: string) => {
          if (library === "bad-lib") {
            throw new Error("Search failed");
          }
          return [{ content: "match", score: 0.8, url: "" }];
        },
      );

      const result = await tool.execute({ query: "test" });

      expect(result.libraries).toHaveLength(1);
      expect(result.libraries[0].name).toBe("good-lib");
    });

    it("should include matched content snippet", async () => {
      const longContent = "A".repeat(300);
      const mockLibraries: LibrarySummary[] = [{ library: "test-lib", versions: [] }];

      vi.mocked(mockDocService.listLibraries).mockResolvedValue(mockLibraries);
      vi.mocked(mockDocService.searchStore).mockResolvedValue([
        { content: longContent, score: 0.9, url: "" },
      ]);

      const result = await tool.execute({ query: "test" });

      expect(result.libraries[0].matchedContent).toBeDefined();
      expect(result.libraries[0].matchedContent?.length).toBeLessThanOrEqual(200);
    });
  });
});
