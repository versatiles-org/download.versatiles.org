<script lang="ts">
	/**
	 * Map area picker: shift+drag draws a selection rectangle, normal drag pans.
	 *
	 * `maplibre-gl` and its stylesheet are imported dynamically inside `onMount`
	 * for two reasons: the site is prerendered with `adapter-static` (a top-level
	 * import would run the library during the build), and the library dwarfs the
	 * rest of the page, so it must stay out of the initial bundle.
	 */
	import { onMount } from 'svelte';
	import type { BBox } from './size_index/estimate.js';

	let { bbox = $bindable() }: { bbox?: BBox } = $props();

	/** Basemap served by the project's own tile server (CORS-enabled). */
	const STYLE_URL = 'https://tiles.versatiles.org/assets/styles/colorful/style.json';

	/** GeoJSON source/layer ids for the selection rectangle. */
	const SOURCE = 'selection';

	let container: HTMLDivElement | undefined = $state();
	let dragBox: HTMLDivElement | undefined = $state();
	let failed = $state(false);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any = null;

	onMount(() => {
		let disposed = false;

		(async () => {
			try {
				await import('maplibre-gl/dist/maplibre-gl.css');
				const maplibre = await import('maplibre-gl');
				// The dialog may have closed while the library was loading.
				if (disposed || !container) return;

				map = new maplibre.Map({
					container,
					style: STYLE_URL,
					center: [10, 50],
					zoom: 2,
					attributionControl: { compact: true },
				});
				map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
				// Built-in shift+drag zoom would fight the selection gesture.
				map.boxZoom.disable();

				map.on('load', () => {
					map.addSource(SOURCE, { type: 'geojson', data: emptyCollection() });
					map.addLayer({
						id: `${SOURCE}-fill`,
						type: 'fill',
						source: SOURCE,
						paint: { 'fill-color': '#4a9eff', 'fill-opacity': 0.25 },
					});
					map.addLayer({
						id: `${SOURCE}-line`,
						type: 'line',
						source: SOURCE,
						paint: { 'line-color': '#4a9eff', 'line-width': 1.5 },
					});
					if (bbox) drawSelection(bbox);
				});

				enableBoxSelect(map);
			} catch {
				failed = true;
			}
		})();

		return () => {
			disposed = true;
			map?.remove();
			map = null;
		};
	});

	function emptyCollection() {
		return { type: 'FeatureCollection' as const, features: [] };
	}

	/** Renders the selection rectangle on the map. */
	function drawSelection(box: BBox): void {
		const source = map?.getSource(SOURCE);
		if (!source) return;
		const [west, south, east, north] = box;
		source.setData({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[west, south],
						[east, south],
						[east, north],
						[west, north],
						[west, south],
					],
				],
			},
		});
	}

	/**
	 * Wires shift+drag on the map canvas to draw a rectangle. Panning is disabled
	 * only for the duration of the gesture, so normal dragging still moves the map.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function enableBoxSelect(mapInstance: any): void {
		const canvas = mapInstance.getCanvasContainer();
		let start: { x: number; y: number } | null = null;

		function position(event: MouseEvent): { x: number; y: number } {
			const rect = canvas.getBoundingClientRect();
			return { x: event.clientX - rect.left, y: event.clientY - rect.top };
		}

		canvas.addEventListener('mousedown', (event: MouseEvent) => {
			if (!event.shiftKey || event.button !== 0) return;
			event.preventDefault();
			mapInstance.dragPan.disable();
			start = position(event);
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		});

		function onMove(event: MouseEvent): void {
			if (!start || !dragBox) return;
			const current = position(event);
			dragBox.style.display = 'block';
			dragBox.style.left = `${Math.min(start.x, current.x)}px`;
			dragBox.style.top = `${Math.min(start.y, current.y)}px`;
			dragBox.style.width = `${Math.abs(current.x - start.x)}px`;
			dragBox.style.height = `${Math.abs(current.y - start.y)}px`;
		}

		function onUp(event: MouseEvent): void {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			mapInstance.dragPan.enable();
			if (dragBox) dragBox.style.display = 'none';
			if (!start) return;

			const end = position(event);
			const from = start;
			start = null;

			// Ignore stray clicks that produced no meaningful area.
			if (Math.abs(end.x - from.x) < 5 || Math.abs(end.y - from.y) < 5) return;

			const a = mapInstance.unproject([from.x, from.y]);
			const b = mapInstance.unproject([end.x, end.y]);
			const next: BBox = [
				round(Math.min(a.lng, b.lng)),
				round(Math.min(a.lat, b.lat)),
				round(Math.max(a.lng, b.lng)),
				round(Math.max(a.lat, b.lat)),
			];
			bbox = next;
			drawSelection(next);
		}
	}

	/** Coordinates go straight into a shell command, so keep them short. */
	function round(value: number): number {
		return Math.round(value * 10000) / 10000;
	}

	/** Selects the currently visible area — the touch/keyboard-friendly path. */
	function useCurrentView(): void {
		if (!map) return;
		const bounds = map.getBounds();
		const next: BBox = [
			round(Math.max(-180, bounds.getWest())),
			round(Math.max(-85, bounds.getSouth())),
			round(Math.min(180, bounds.getEast())),
			round(Math.min(85, bounds.getNorth())),
		];
		bbox = next;
		drawSelection(next);
	}

	function clear(): void {
		bbox = undefined;
		map?.getSource(SOURCE)?.setData(emptyCollection());
	}
</script>

<div class="bbox-input">
	{#if failed}
		<p class="map-error small">Map could not be loaded. The whole dataset will be downloaded.</p>
	{:else}
		<div class="map" bind:this={container}>
			<div class="drag-box" bind:this={dragBox}></div>
		</div>
		<div class="controls small">
			<span>⇧ + drag to select an area</span>
			<span class="spacer"></span>
			<button onclick={useCurrentView}>Use current view</button>
			<button onclick={clear} disabled={!bbox}>Whole world</button>
		</div>
	{/if}
</div>

<style lang="scss">
	.map {
		position: relative;
		height: 16rem;
		border-radius: 4px;
		overflow: hidden;
		background: #111;
	}

	.drag-box {
		display: none;
		position: absolute;
		z-index: 2;
		background: rgba(74, 158, 255, 0.25);
		border: 1.5px solid #4a9eff;
		pointer-events: none;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.5em;
		margin-top: 0.4em;

		.spacer {
			flex: 1;
		}

		button {
			background: #333;
			border: none;
			color: #ccc;
			padding: 0.3em 0.8em;
			cursor: pointer;
			border-radius: 4px;
			font-size: 1em;

			&:hover:not(:disabled) {
				background: #444;
			}

			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
	}

	.map-error {
		margin: 0;
		padding: 1em 0;
		text-align: center;
	}
</style>
