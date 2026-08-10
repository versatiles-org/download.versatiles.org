<script lang="ts">
	import type { FileRefData } from './data.js';
	import type { SizeIndex } from './size_index/types.js';
	import { buildCommand, type Format, type Tool } from './command.js';
	import { estimateDownloadSize, formatBytes, loadSizeIndex, zoomLevels, type BBox } from './size_index/estimate.js';

	let { file }: { file: FileRefData } = $props();

	/**
	 * Radio groups are keyed by `name`, and the page renders one dialog per file,
	 * so the name has to be unique per instance or every dialog would share one
	 * format selection.
	 */
	const uid = $props.id();

	/** Fallback zoom ceiling before an index tells us the real one. */
	const DEFAULT_MAX_ZOOM = 14;

	let format: Format = $state('versatiles');
	let tool: Tool = $state('versatiles');

	/** What the copy button reports back after being pressed. */
	let copyState: 'idle' | 'copied' | 'failed' = $state('idle');

	/**
	 * Restricting the area is opt-in: the default is the whole planet, which is
	 * what the plain command downloads. Keeping this as explicit state — rather
	 * than inferring it from `bbox` being set — gives the user a way back after
	 * drawing a box, which the map itself does not offer.
	 */
	let area: 'planet' | 'bbox' = $state('planet');
	let bbox: BBox | undefined = $state();
	let minZoom = $state(0);
	let maxZoom = $state(DEFAULT_MAX_ZOOM);
	/** Null once we know the dataset has no index; undefined while unknown. */
	let sizeIndex: SizeIndex | null | undefined = $state();

	/**
	 * `BBoxMap` pulls in maplibre and a basemap style, so it is imported only once
	 * the user asks for an area — most downloads are of the whole planet and never
	 * need it. Keeping it out of module scope also keeps it out of the prerender,
	 * which runs in Node.
	 */
	let BBoxMap = $state<typeof import('@versatiles/svelte').BBoxMap | undefined>();

	/** Switches between the whole planet and a drawn area, loading the map on demand. */
	function selectArea(next: 'planet' | 'bbox') {
		area = next;
		if (next === 'planet') {
			bbox = undefined;
		} else if (!BBoxMap) {
			import('@versatiles/svelte').then((module) => (BBoxMap = module.BBoxMap));
		}
	}

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

	const command = $derived(
		buildCommand({ tool, source: fullUrl, output: outputFile, bbox, minZoom, maxZoom, zoomCeiling }),
	);

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
		pressedOnBackdrop = false;
		dialog.showModal();
		// `showModal()` makes the page inert but not unscrollable: on touch, a
		// gesture that runs past the end of the dialog scrolls the page behind it.
		document.body.style.overflow = 'hidden';

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
	}

	function close() {
		dialog.close();
	}

	/**
	 * Releasing the lock here rather than in `close()` covers every way the dialog
	 * can go away — including Esc, which closes it without calling `close()` and
	 * would otherwise leave the page permanently unscrollable.
	 */
	function onDialogClose() {
		document.body.style.overflow = '';
	}

	/**
	 * Whether the press that is currently in flight started on the backdrop.
	 *
	 * A `click` is dispatched on the nearest common ancestor of press and
	 * release, and since the dialog has no padding, the only element that *is*
	 * the dialog is its backdrop. So a drag that starts on a zoom thumb or on the
	 * map and ends past the dialog's edge — which is most of them — arrives here
	 * indistinguishable from a click on the backdrop, and would throw the user's
	 * selection away mid-gesture. Requiring the press to have started on the
	 * backdrop too tells the two apart.
	 */
	let pressedOnBackdrop = false;

	function backdropPointerDown(e: PointerEvent) {
		pressedOnBackdrop = e.target === dialog;
	}

	function backdropClick(e: MouseEvent) {
		if (pressedOnBackdrop && e.target === dialog) close();
	}

	let commandBlock: HTMLElement;
	let resetCopyState: ReturnType<typeof setTimeout> | undefined;

	/** Selects the command, so ⌘C/Ctrl+C does what the button could not. */
	function selectCommand() {
		const selection = window.getSelection();
		if (!selection) return;

		const range = document.createRange();
		range.selectNodeContents(commandBlock);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	async function copy() {
		try {
			// Not guaranteed to exist: the API is only exposed in a secure context,
			// so a preview build opened over plain http on a LAN address has no
			// `navigator.clipboard` at all. Unguarded, that leaves the button
			// looking broken and an unhandled rejection in the console.
			await navigator.clipboard.writeText(command);
			copyState = 'copied';
		} catch {
			selectCommand();
			copyState = 'failed';
		}

		clearTimeout(resetCopyState);
		resetCopyState = setTimeout(() => (copyState = 'idle'), 1500);
	}

	const formats = ['versatiles', 'pmtiles', 'mbtiles', 'tar'] as const;
</script>

<button class="convert-btn" onclick={open} title="Convert to other format">&hellip;</button>

<dialog bind:this={dialog} onpointerdown={backdropPointerDown} onclick={backdropClick} onclose={onDialogClose}>
	<div class="dialog-content">
		<div class="dialog-header">
			<span>Download <strong>{baseName}</strong></span>
			<button class="close-btn" onclick={close}>&#x2715;</button>
		</div>

		<div class="dialog-body">
			<div class="controls">
				<section class="area">
					<span class="label">Select an area:</span>
					<div class="segmented">
						<label class:active={area === 'planet'}>
							<input
								type="radio"
								name="{uid}-area"
								value="planet"
								checked={area === 'planet'}
								onchange={() => selectArea('planet')}
							/>
							whole planet
						</label>
						<label class:active={area === 'bbox'}>
							<input
								type="radio"
								name="{uid}-area"
								value="bbox"
								checked={area === 'bbox'}
								onchange={() => selectArea('bbox')}
							/>
							bounding box
						</label>
					</div>

					{#if area === 'bbox'}
						<div class="bbox-map">
							{#if BBoxMap}
								<BBoxMap bind:selectedBBox={bbox} />
							{/if}
						</div>
						{#if !bbox}
							<p class="hint">Drag a box on the map, or search for a place.</p>
						{/if}
					{/if}
				</section>

				<section class="options">
					<span class="label">Select a format:</span>
					<div class="segmented">
						{#each formats as f}
							<label class:active={format === f}>
								<input type="radio" name="{uid}-format" value={f} bind:group={format} />
								.{f}
							</label>
						{/each}
					</div>

					<div class="toggle-tool">
						<span class="label">Select a tool:</span>
						<div class="segmented">
							<label class:active={tool === 'versatiles'}>
								<input type="radio" name="{uid}-tool" value="versatiles" bind:group={tool} />
								versatiles binary
							</label>
							<label class:active={tool === 'docker'}>
								<input type="radio" name="{uid}-tool" value="docker" bind:group={tool} />
								via docker
							</label>
						</div>
						{#if tool === 'versatiles'}
							<a
								class="install-link"
								href="https://docs.versatiles.org/guides/install_versatiles.html"
								target="_blank"
								rel="noopener noreferrer">How to install the versatiles binary &#x2197;</a
							>
						{:else}
							<span class="install-note">Nothing to install — docker pulls the image on first run.</span>
						{/if}
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
						<div class="range-scale">
							<span>0</span>
							<span>{zoomCeiling}</span>
						</div>
					</div>
				</section>
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
						{#if isFullDownload}<span>whole dataset</span>{/if}
					{/if}
				</span>
				<button class="copy-btn" onclick={copy}>
					{copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
				</button>
			</div>
			<pre bind:this={commandBlock}><code>{command}</code></pre>
		</div>
	</div>
</dialog>

<style>
	.convert-btn {
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
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
		/*
		 * `vh` resolves against the *large* viewport, i.e. with the mobile browser
		 * toolbars retracted, so a 90vh dialog can be taller than the area actually
		 * on screen and its result bar ends up out of reach. `dvh` tracks the
		 * visible height. The `vh` line is a fallback for browsers without `dvh`;
		 * lightningcss drops it when the configured targets all support `dvh`.
		 */
		max-height: 90vh;
		max-height: 90dvh;
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

	/*
	 * `flex: 1 1 auto`, not `flex: 1`.
	 *
	 * `flex: 1` is `flex-basis: 0`, and the dialog's height is *auto* — only
	 * capped by `max-height`. Sizing an auto-height flex container is supposed to
	 * use each item's content height, but WebKit uses the flex base size instead,
	 * which is 0 here: the dialog then collapses to its 1px borders and Safari
	 * shows a darkened page with a horizontal line where the dialog should be.
	 *
	 * An `auto` basis makes the intrinsic contribution the content height in every
	 * engine, and `min-height: 0` still lets the body shrink and scroll once
	 * `max-height` bites. (The phone rule below sets a definite `height`, which is
	 * why the full-bleed sheet was never affected.)
	 */
	.dialog-content {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		font-size: 0.8rem;
	}

	.dialog-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		/* Stops a touch scroll that reaches the end here from scrolling the page. */
		overscroll-behavior: contain;
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

	/*
	 * Below this width the dialog becomes a full-bleed sheet. A centred box that
	 * merely fits leaves the map competing with the body for the little vertical
	 * space there is — the map swallows drag gestures, so a short scroll area next
	 * to it is nearly impossible to use.
	 */
	@media (max-width: 44rem) {
		.controls {
			grid-template-columns: 1fr;
		}

		dialog {
			width: 100%;
			max-width: 100%;
			height: 100vh;
			height: 100dvh;
			max-height: 100vh;
			max-height: 100dvh;
			border: none;
			border-radius: 0;
		}

		.bbox-map {
			height: 14rem;
		}

		.result-bar pre {
			max-height: 4.5em;
		}
	}

	/* Landscape phones: keep the result bar from crowding out the controls. */
	@media (max-height: 30rem) {
		.bbox-map {
			height: 12rem;
		}

		.result-bar pre {
			max-height: 4.5em;
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

	/*
	 * Segmented control: the options are joined inside one outlined track rather
	 * than floating as separate pills, so they read as "pick one of these" instead
	 * of as independent buttons. Backed by real radio inputs, which also gives
	 * arrow-key navigation and the right announcement to screen readers.
	 */
	.segmented {
		display: inline-flex;
		border: 1px solid #3a3a3a;
		border-radius: 5px;
		overflow: hidden;
		background: #222;
		max-width: 100%;

		label {
			position: relative;
			padding: 0.4em 0.75em;
			line-height: 1.3;
			color: #aaa;
			cursor: pointer;
			white-space: nowrap;
			user-select: none;

			& + label {
				border-left: 1px solid #3a3a3a;
			}

			&:hover {
				background: #2c2c2c;
				color: #eee;
			}

			&.active {
				background: #4a9eff;
				color: #08151f;
				font-weight: 600;
			}

			/* The input is visually hidden, so mirror its focus ring onto the label. */
			&:has(input:focus-visible) {
				outline: 2px solid #4a9eff;
				outline-offset: -2px;
			}

			/*
			 * WebKit never matches `:focus-visible` on a radio — `:focus` does, but
			 * `:focus-visible` stays false however the focus got there — so the rule
			 * above leaves Safari with no focus indicator at all on a control whose
			 * only input is 1px and transparent.
			 *
			 * Falling back to plain `:focus` is safe *here*: macOS does not focus a
			 * radio when it is clicked, so a focused radio in WebKit already means
			 * the keyboard put it there, which is exactly what `:focus-visible` is
			 * for. Scoped to the usual WebKit-only feature query, since applying it
			 * everywhere would put a ring on every mouse click in the other engines.
			 */
			@supports (-webkit-hyphens: none) {
				&:has(input:focus) {
					outline: 2px solid #4a9eff;
					outline-offset: -2px;
				}
			}
		}

		input {
			position: absolute;
			width: 1px;
			height: 1px;
			opacity: 0;
			pointer-events: none;
			margin: 0;
		}
	}

	.toggle-tool {
		margin-top: 1em;
	}

	/*
	 * Both variants occupy the same slot under the tool control, so switching
	 * tools does not shift the rest of the column.
	 */
	.install-link,
	.install-note {
		display: block;
		margin-top: 0.5em;
		font-size: 0.8em;
	}

	.hint {
		margin: 0.4em 0 0;
		opacity: 0.5;
		font-size: 0.8em;
	}

	.bbox-map {
		margin-top: 0.6em;
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
		font-size: inherit;
	}

	.install-link {
		opacity: 0.7;
		text-decoration: underline;

		&:hover {
			opacity: 1;
		}
	}

	.install-note {
		opacity: 0.5;
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
		font-size: 0.7rem;
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
