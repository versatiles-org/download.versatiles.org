<script lang="ts">
	import type { FileRefData } from './data.js';
	import type { SizeIndex } from './size_index/types.js';
	import { estimateDownloadSize, formatBytes, loadSizeIndex, zoomLevels, type BBox } from './size_index/estimate.js';

	let { file }: { file: FileRefData } = $props();

	/** Fallback zoom ceiling before an index tells us the real one. */
	const DEFAULT_MAX_ZOOM = 14;

	let format: 'versatiles' | 'pmtiles' | 'mbtiles' | 'tar' = $state('pmtiles');
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

	// Keep the zoom range coherent as either end moves.
	$effect(() => {
		if (minZoom > maxZoom) minZoom = maxZoom;
	});

	function open() {
		dialog.showModal();

		// Fetched on open, never with the page: the osm index alone is ~490 KB gzip.
		if (sizeIndex === undefined) {
			loadSizeIndex(file.url).then((index) => {
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

		<span class="label">Select a format:</span>
		<div class="toggle-format">
			{#each formats as f}
				<button class:active={format === f} onclick={() => (format = f)}>.{f}</button>
			{/each}
		</div>

		<div class="toggle-tool">
			<span class="label">Select a tool:</span>
			<div class="toggles">
				<button class:active={tool === 'versatiles'} onclick={() => (tool = 'versatiles')}>versatiles binary</button>
				<a
					class="install-link"
					href="https://docs.versatiles.org/guides/install_versatiles.html"
					target="_blank"
					rel="noopener noreferrer"
					title="Installation instructions">&#x2197;</a
				>
				<button class:active={tool === 'docker'} onclick={() => (tool = 'docker')}>docker</button>
			</div>
		</div>

		<span class="label">Select an area:</span>
		<div class="bbox-map">
			{#if BBoxMap}
				<BBoxMap bind:selectedBBox={bbox} />
			{/if}
		</div>

		<div class="zoom-row">
			<span class="label">Select zoom levels:</span>
			<div class="sliders">
				<label>
					<span class="small">min {minZoom}</span>
					<input type="range" min="0" max={zoomCeiling} bind:value={minZoom} />
				</label>
				<label>
					<span class="small">max {maxZoom}</span>
					<input type="range" min="0" max={zoomCeiling} bind:value={maxZoom} />
				</label>
			</div>
		</div>

		{#if estimate !== undefined}
			<p class="estimate">
				Estimated download: <strong>~ {formatBytes(estimate)}</strong>
				{#if isFullDownload}<span class="small">(whole dataset)</span>{/if}
			</p>
		{/if}

		<div class="command-row">
			<span class="label">Run this command:</span>
			<pre><code>{command}</code></pre>
			<button class="copy-btn" onclick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
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
		width: 40rem;

		&::backdrop {
			background: rgba(0, 0, 0, 0.7);
		}
	}

	.dialog-content {
		padding: 1.2em;
	}

	.dialog-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.8em;
		font-size: 1.1em;

		strong {
			color: #fff;
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
		margin-bottom: 1.5em;
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
		margin-top: 1em;

		.sliders {
			display: flex;
			gap: 1.5em;
		}

		label {
			flex: 1;
			display: flex;
			flex-direction: column;
			gap: 0.2em;
		}

		input[type='range'] {
			width: 100%;
			accent-color: #4a9eff;
		}
	}

	.estimate {
		margin: 1em 0 1.5em;
		text-align: center;

		strong {
			color: #fff;
			font-variant-numeric: tabular-nums;
		}
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

	.command-row {
		display: flex;
		flex-direction: column;
		gap: 0em;
	}

	pre {
		flex: 1;
		background: #080808;
		padding: 0.4em 0.6em;
		border-radius: 4px;
		overflow-x: auto;
		margin: 0;
		font-size: 0.6em;
		line-height: 1.5em;
	}

	code {
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
	}

	.copy-btn {
		background: #333;
		border: none;
		color: #ccc;
		padding: 0.5em 1em;
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.85em;
		white-space: nowrap;

		&:hover {
			background: #444;
		}
	}
</style>
