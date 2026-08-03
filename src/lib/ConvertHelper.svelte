<script lang="ts">
	import type { FileRefData } from './data.js';
	import type { SizeIndex } from './size_index/types.js';
	import { estimateDownloadSize, formatBytes, loadSizeIndex, zoomLevels, type BBox } from './size_index/estimate.js';

	let { file }: { file: FileRefData } = $props();

	/** Fallback zoom ceiling before an index tells us the real one. */
	const DEFAULT_MAX_ZOOM = 14;

	let format: 'versatiles' | 'pmtiles' | 'mbtiles' | 'tar' = $state('versatiles');
	let tool: 'versatiles' | 'docker' = $state('versatiles');
	let copied = $state(false);

	let bbox: BBox | undefined = $state();
	let minZoom = $state(0);
	let maxZoom = $state(DEFAULT_MAX_ZOOM);
	/** Null once we know the dataset has no index; undefined while unknown. */
	let sizeIndex: SizeIndex | null | undefined = $state();

	/**
	 * `BBoxMap` pulls in maplibre and a basemap style, so it is imported when the
	 * dialog first opens rather than with the page. Keeping it out of the module
	 * scope also keeps it out of the prerender, which runs in Node.
	 */
	let BBoxMap = $state<typeof import('@versatiles/svelte').BBoxMap | undefined>();

	let dialog: HTMLDialogElement;

	const baseName = $derived(file.filename.replace(/\.versatiles$/, ''));
	const outputFile = $derived(`${baseName}.${format}`);
	const fullUrl = $derived(`https://download.versatiles.org${file.url}`);

	const availableZooms = $derived(sizeIndex ? zoomLevels(sizeIndex) : []);
	const zoomCeiling = $derived(
		availableZooms.length > 0 ? availableZooms[availableZooms.length - 1]! : DEFAULT_MAX_ZOOM,
	);

	/** Bytes the command will download, or undefined when no index is available. */
	const estimate = $derived(sizeIndex ? estimateDownloadSize(sizeIndex, bbox, minZoom, maxZoom) : undefined);

	/** True while the selection still covers everything the container holds. */
	const isFullDownload = $derived(!bbox && minZoom <= 0 && maxZoom >= zoomCeiling);

	function buildCommand(
		t: typeof tool,
		source: string,
		output: string,
		box: BBox | undefined,
		zMin: number,
		zMax: number,
		zCeiling: number,
	): string {
		let parts: string[] = [];
		switch (t) {
			case 'versatiles':
				parts.push('versatiles convert');
				break;
			case 'docker':
				parts.push('docker run -it --rm -v $(pwd):/data', 'versatiles/versatiles:latest convert');
				break;
		}
		// Only emit flags that actually narrow the download, so an untouched
		// dialog still shows the plain whole-file command.
		if (box) parts.push(`--bbox ${box.join(',')}`);
		if (zMin > 0) parts.push(`--min-zoom ${zMin}`);
		if (zMax < zCeiling) parts.push(`--max-zoom ${zMax}`);
		parts.push(`"${source}"`, `"${t == 'docker' ? '/data/' : ''}${output}"`);
		return parts.join(' \\\n  ');
	}

	const command = $derived(buildCommand(tool, fullUrl, outputFile, bbox, minZoom, maxZoom, zoomCeiling));

	/** Position of a zoom level along the track, as a percentage. */
	function trackPercent(zoom: number): number {
		return zoomCeiling === 0 ? 0 : (zoom / zoomCeiling) * 100;
	}

	// The two thumbs share one track, so dragging one past the other pushes it
	// rather than producing an inverted range. Handled on input rather than in an
	// effect, so loading an index can move `maxZoom` without dragging `minZoom`.
	function onMinInput() {
		if (minZoom > maxZoom) maxZoom = minZoom;
	}

	function onMaxInput() {
		if (maxZoom < minZoom) minZoom = maxZoom;
	}

	function open() {
		dialog.showModal();

		// Fetched on open, never with the page: the osm index alone is ~490 KB gzip.
		// Absolute, like the command's source url, so the estimate also works when
		// the site is served from somewhere else (`npm run dev`, a preview deploy).
		if (sizeIndex === undefined) {
			loadSizeIndex(fullUrl).then((index) => {
				sizeIndex = index;
				if (index) {
					const zooms = zoomLevels(index);
					maxZoom = zooms[zooms.length - 1] ?? DEFAULT_MAX_ZOOM;
				}
			});
		}

		if (!BBoxMap) {
			import('@versatiles/svelte').then((module) => (BBoxMap = module.BBoxMap));
		}
	}

	function close() {
		dialog.close();
	}

	function backdropClick(e: MouseEvent) {
		if (e.target === dialog) close();
	}

	async function copy() {
		await navigator.clipboard.writeText(command);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	const formats = ['versatiles', 'pmtiles', 'mbtiles', 'tar'] as const;
</script>

<button class="convert-btn" onclick={open} title="Convert to other format">&hellip;</button>

<dialog bind:this={dialog} onclick={backdropClick}>
	<div class="dialog-content">
		<div class="dialog-header">
			<span>Download <strong>{baseName}</strong></span>
			<button class="close-btn" onclick={close}>&#x2715;</button>
		</div>

		<div class="dialog-body">
			<div class="controls">
				<section class="area">
					<span class="label">Select an area:</span>
					<div class="bbox-map">
						{#if BBoxMap}
							<BBoxMap bind:selectedBBox={bbox} />
						{/if}
					</div>
				</section>

				<section class="options">
					<span class="label">Select a format:</span>
					<div class="toggle-format">
						{#each formats as f}
							<button class:active={format === f} onclick={() => (format = f)}>.{f}</button>
						{/each}
					</div>

					<div class="toggle-tool">
						<span class="label">Select a tool:</span>
						<div class="toggles">
							<button class:active={tool === 'versatiles'} onclick={() => (tool = 'versatiles')}
								>versatiles binary</button
							>
							<a
								class="install-link"
								href="https://docs.versatiles.org/guides/install_versatiles.html"
								target="_blank"
								rel="noopener noreferrer"
								title="Installation instructions">&#x2197;</a
							>
							<button class:active={tool === 'docker'} onclick={() => (tool = 'docker')}>via docker</button>
						</div>
					</div>
				</section>
			</div>

			<div class="zoom-row">
				<div class="zoom-head">
					<span class="label">Select zoom levels:</span>
					<span class="zoom-value">{minZoom} – {maxZoom}</span>
				</div>
				<div class="range">
					<div class="range-track"></div>
					<div
						class="range-fill"
						style="left: {trackPercent(minZoom)}%; width: {trackPercent(maxZoom) - trackPercent(minZoom)}%"
					></div>
					<input
						type="range"
						min="0"
						max={zoomCeiling}
						bind:value={minZoom}
						oninput={onMinInput}
						aria-label="Lowest zoom level"
					/>
					<input
						type="range"
						min="0"
						max={zoomCeiling}
						bind:value={maxZoom}
						oninput={onMaxInput}
						aria-label="Highest zoom level"
					/>
				</div>
				<div class="range-scale small">
					<span>0</span>
					<span>{zoomCeiling}</span>
				</div>
			</div>
		</div>

		<div class="result-bar">
			<div class="result-head">
				<span class="result-size">
					{#if estimate === undefined}
						<span class="label">Run this command</span>
					{:else}
						<span class="label">Estimated file size</span>
						<strong>~ {formatBytes(estimate)}</strong>
						{#if isFullDownload}<span class="small">whole dataset</span>{/if}
					{/if}
				</span>
				<button class="copy-btn" onclick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
			</div>
			<pre><code>{command}</code></pre>
		</div>
	</div>
</dialog>

<style lang="scss">
	.convert-btn {
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		font-size: 0.85em;
		padding: 0 0.2em;
		line-height: 1;

		&:hover {
			color: #fff;
		}
	}

	dialog {
		background: #1a1a1a;
		color: #ccc;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0;
		max-width: 90vw;
		width: 52rem;
		max-height: 90vh;
		overflow: hidden;

		&::backdrop {
			background: rgba(0, 0, 0, 0.7);
		}
	}

	/*
	 * Scoped to [open]: a closed dialog relies on the UA stylesheet's
	 * `display: none`, so declaring `display` on `dialog` itself would show every
	 * dialog on the page. The column layout keeps the result bar pinned while the
	 * controls above it scroll.
	 */
	dialog[open] {
		display: flex;
		flex-direction: column;
	}

	.dialog-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.dialog-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 1.2em 1.2em;
	}

	.dialog-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 1.1em;
		padding: 1.2em 1.2em 0.8em;

		strong {
			color: #fff;
		}
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.2em;
		align-items: start;
	}

	@media (max-width: 44rem) {
		.controls {
			grid-template-columns: 1fr;
		}
	}

	.close-btn {
		background: none;
		border: none;
		color: #ccc;
		font-size: 1.2em;
		cursor: pointer;
		padding: 0.2em 0.4em;

		&:hover {
			color: #fff;
		}
	}

	.toggle-format {
		display: flex;
		gap: 0.4em;
		flex-wrap: wrap;
		margin-bottom: 1em;

		button {
			background: #333;
			border: none;
			color: #ccc;
			padding: 0.4em 0.9em;
			cursor: pointer;
			border-radius: 4px;
			font-size: 0.95em;

			&:hover {
				background: #444;
			}

			&.active {
				background: #555;
				color: #fff;
			}
		}
	}

	.toggle-tool {
		margin-top: 1em;
	}

	.bbox-map {
		height: 18rem;
		border-radius: 4px;
		overflow: hidden;
		background: #111;
		/* BBoxMap styles its toolbar from these; the package ships no defaults. */
		--bg-color: #1a1a1a;
		--fg-color: #ccc;
	}

	.zoom-row {
		margin-top: 1.5em;
	}

	.zoom-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.zoom-value {
		color: #fff;
		font-variant-numeric: tabular-nums;
	}

	/*
	 * One range, two thumbs: both inputs span the full track so their thumbs stay
	 * aligned with the shared scale. The inputs themselves ignore pointer events
	 * so the lower one is still reachable; only the thumbs accept them.
	 */
	.range {
		position: relative;
		height: 1.6em;
		margin-top: 0.2em;

		input[type='range'] {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			margin: 0;
			appearance: none;
			background: none;
			pointer-events: none;

			&::-webkit-slider-thumb {
				appearance: none;
				pointer-events: auto;
				width: 1em;
				height: 1em;
				border: none;
				border-radius: 50%;
				background: #4a9eff;
				cursor: grab;
			}

			&::-moz-range-thumb {
				pointer-events: auto;
				width: 1em;
				height: 1em;
				border: none;
				border-radius: 50%;
				background: #4a9eff;
				cursor: grab;
			}

			&:focus-visible {
				outline: none;

				&::-webkit-slider-thumb {
					box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.5);
				}

				&::-moz-range-thumb {
					box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.5);
				}
			}
		}
	}

	.range-track,
	.range-fill {
		position: absolute;
		top: 50%;
		height: 0.25em;
		border-radius: 0.125em;
		transform: translateY(-50%);
		pointer-events: none;
	}

	.range-track {
		left: 0;
		right: 0;
		background: #333;
	}

	.range-fill {
		background: #4a9eff;
	}

	.range-scale {
		display: flex;
		justify-content: space-between;
	}

	.label {
		display: block;
		margin-bottom: 0.4em;
		opacity: 0.6;
		font-size: 0.9em;
	}

	.toggles {
		display: flex;
		gap: 0.4em;
		align-items: center;

		button {
			background: #333;
			border: none;
			color: #ccc;
			padding: 0.3em 0.8em;
			cursor: pointer;
			border-radius: 4px;
			font-size: 0.9em;

			&:hover {
				background: #444;
			}

			&.active {
				background: #555;
				color: #fff;
			}
		}
	}

	.install-link {
		font-size: 0.9em;
		opacity: 0.4;
		margin-right: 1em;

		&:hover {
			opacity: 0.8;
		}
	}

	/*
	 * The command and its size are the dialog's output, so they sit together in a
	 * bar that stays visible while the controls above scroll.
	 */
	.result-bar {
		flex-shrink: 0;
		border-top: 1px solid #333;
		background: #151515;
		padding: 0.8em 1.2em 1em;
	}

	.result-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1em;
		margin-bottom: 0.4em;
	}

	.result-size {
		display: flex;
		align-items: baseline;
		gap: 0.5em;
		min-width: 0;

		.label {
			margin-bottom: 0;
		}

		strong {
			color: #fff;
			font-variant-numeric: tabular-nums;
		}
	}

	pre {
		background: #080808;
		padding: 0.6em 0.8em;
		border-radius: 4px;
		overflow: auto;
		/* Long docker commands stay readable without pushing the controls away. */
		max-height: 7.5em;
		margin: 0;
		font-size: 0.72em;
		line-height: 1.5em;
	}

	code {
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
	}

	.copy-btn {
		background: #333;
		border: none;
		color: #ccc;
		padding: 0.4em 1.1em;
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.85em;
		white-space: nowrap;
		flex-shrink: 0;

		&:hover {
			background: #444;
		}
	}
</style>
