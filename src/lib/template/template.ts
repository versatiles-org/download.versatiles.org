/**
 * Template rendering utilities for generating the HTML and RSS output of
 * download.versatiles.org.
 *
 * All templates are Handlebars files stored under `template/` and receive
 * strongly typed data structures (`FileGroup[]`) as input. This module produces:
 *
 * - `index.html` — the main overview page listing all file groups
 * - `feed-<slug>.xml` — per-group RSS feeds for version updates
 *
 * These outputs are returned as `FileResponse` objects so they can be uploaded
 * to R2 as site assets (see `../site/site.ts`).
 */
import { readFileSync } from 'fs';
import Handlebars from 'handlebars';
import type { FileGroup } from '../file/file_group.js';
import { FileResponse } from '../file/file_response.js';

/**
 * Renders a Handlebars template from the `template/` directory.
 *
 * Parameters:
 * - `fileGroups`: the data passed into the template as `{ fileGroups }`
 * - `templateFilename`: the filename under `template/` (e.g. `"index.html"`)
 *
 * Returns the rendered template as a UTF‑8 string.
 *
 * Throws:
 * - If the template file cannot be found or read.
 */
export function renderTemplate(fileGroups: FileGroup[], templateFilename: string): string {
	const templateUrl = new URL(`../../../template/${templateFilename}`, import.meta.url);
	const template = Handlebars.compile(readFileSync(templateUrl, 'utf-8'));
	return template({ fileGroups });
}

/**
 * Generates the main `index.html` as a `FileResponse` (key `/index.html`).
 */
export function generateHTML(fileGroups: FileGroup[]): FileResponse {
	return new FileResponse('/index.html', renderTemplate(fileGroups, 'index.html'), 'text/html');
}

/**
 * Generates per‑group RSS feeds (`/feed-<slug>.xml`) as `FileResponse` objects.
 */
export function generateRSSFeeds(fileGroups: FileGroup[]): FileResponse[] {
	return fileGroups.map(g =>
		new FileResponse(`/feed-${g.slug}.xml`, renderTemplate([g], 'feed.xml'), 'application/rss+xml'));
}
