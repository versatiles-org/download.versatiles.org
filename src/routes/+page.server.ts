import { loadFileGroups, type FileRefData, type PageFileData, type PageGroupData } from '#lib/data.js';
import type { PageServerLoad } from './$types.js';

/** Copies only the fields the page renders; see `PageFileData` for why. */
function pageFile({ filename, url, sizeString }: FileRefData): PageFileData {
	return { filename, url, sizeString };
}

export const load: PageServerLoad = () => {
	const fileGroups: PageGroupData[] = loadFileGroups().map(({ latestFile, olderFiles, ...group }) => ({
		...group,
		latestFile: latestFile && pageFile(latestFile),
		olderFiles: olderFiles.map(pageFile),
	}));
	return { fileGroups };
};
