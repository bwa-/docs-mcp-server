import type { LibraryInfo } from "../../tools/ListLibrariesTool";
import type { VersionSummary } from "../../store/types";
import AddVersionButton from "./AddVersionButton";
import VersionDetailsRow from "./VersionDetailsRow";

/**
 * Props for the LibraryDetailCard component.
 */
interface LibraryDetailCardProps {
  library: LibraryInfo;
}

/**
 * Renders a card displaying library details and its versions.
 * Includes Delete and Refresh buttons for each version, and an "Add New Version" button.
 * @param props - Component props including the library information.
 */
const LibraryDetailCard = ({ library }: LibraryDetailCardProps) => {
  // Versions are already sorted descending (latest first) from the API
  const versions = library.versions || [];
  const latestVersion = versions[0];
  return (
    <div class="block p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 mb-4">
      <div class="flex justify-between items-start mb-1">
        <div>
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">
            <span safe>{library.name}</span>
          </h3>
          {latestVersion?.sourceUrl ? (
            <div class="text-sm text-gray-500 dark:text-gray-400">
              <a
                href={latestVersion.sourceUrl}
                target="_blank"
                class="hover:underline"
                safe
              >
                {latestVersion.sourceUrl}
              </a>
            </div>
          ) : null}
        </div>
      </div>
      {/* Container for version rows - auto-refreshes on library-change */}
      <div
        class="mt-2"
        id="version-list"
        hx-get={`/web/libraries/${encodeURIComponent(library.name)}/versions-list`}
        hx-trigger="library-change from:body"
        hx-swap="morph:innerHTML"
      >
        {versions.length > 0 ? (
          versions.map((v) => {
            const adapted: VersionSummary = {
              id: -1,
              ref: { library: library.name, version: v.version },
              status: v.status,
              progress: v.progress,
              counts: {
                documents: v.documentCount,
                uniqueUrls: v.uniqueUrlCount,
              },
              indexedAt: v.indexedAt,
              sourceUrl: v.sourceUrl ?? undefined,
            };
            return (
              <VersionDetailsRow
                libraryName={library.name}
                version={adapted}
                showDelete={true}
                showRefresh={true}
              />
            );
          })
        ) : (
          <p class="text-sm text-gray-500 dark:text-gray-400 italic">
            No versions indexed.
          </p>
        )}
      </div>
      {/* Add New Version Section */}
      <div id="add-version-form-container" class="mt-4">
        <AddVersionButton libraryName={library.name} />
      </div>

      {/* Library Settings */}
      {(library.description || library.delayBetweenPagesMs || library.maxRetries) && (
        <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h4 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            Library Settings
          </h4>
          <dl class="space-y-1 text-sm">
            {library.description && (
              <div>
                <dt class="inline font-medium text-gray-700 dark:text-gray-300">Description: </dt>
                <dd class="inline text-gray-600 dark:text-gray-400">{library.description}</dd>
              </div>
            )}
            {library.delayBetweenPagesMs !== undefined && library.delayBetweenPagesMs > 0 && (
              <div>
                <dt class="inline font-medium text-gray-700 dark:text-gray-300">Default Delay: </dt>
                <dd class="inline text-gray-600 dark:text-gray-400">
                  {library.delayBetweenPagesMs}ms (~{Math.round(library.delayBetweenPagesMs / 1000)}s between pages)
                </dd>
              </div>
            )}
            {library.maxRetries !== undefined && library.maxRetries !== null && (
              <div>
                <dt class="inline font-medium text-gray-700 dark:text-gray-300">Default Max Retries: </dt>
                <dd class="inline text-gray-600 dark:text-gray-400">{library.maxRetries}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
};

export default LibraryDetailCard;
