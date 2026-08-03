import { describe, it, expect } from 'vitest';
import { buildCommand } from './command.js';
import type { BBox } from './size_index/estimate.js';

const SOURCE = 'https://download.versatiles.org/osm.versatiles';
const BERLIN: BBox = [13, 52.3, 13.8, 52.7];

/** The options an untouched dialog produces: whole world, full zoom range. */
function untouched(overrides = {}) {
	return { tool: 'versatiles' as const, source: SOURCE, output: 'osm.versatiles', zoomCeiling: 14, ...overrides };
}

describe('buildCommand', () => {
	it('emits no narrowing flags when nothing is selected', () => {
		expect(buildCommand(untouched())).toBe(`versatiles convert \\\n  "${SOURCE}" \\\n  "osm.versatiles"`);
	});

	it('quotes source and output so shell metacharacters are safe', () => {
		const command = buildCommand(untouched());
		expect(command).toContain(`"${SOURCE}"`);
		expect(command).toContain('"osm.versatiles"');
	});

	it('joins continuation lines with a backslash', () => {
		expect(buildCommand(untouched()).split(' \\\n  ')).toHaveLength(3);
	});

	describe('bbox', () => {
		it('emits comma-separated coordinates', () => {
			expect(buildCommand(untouched({ bbox: BERLIN }))).toContain('--bbox 13,52.3,13.8,52.7');
		});

		it('is omitted when undefined', () => {
			expect(buildCommand(untouched())).not.toContain('--bbox');
		});

		it('never emits --bbox-border, which the size estimate assumes is 0', () => {
			expect(buildCommand(untouched({ bbox: BERLIN }))).not.toContain('--bbox-border');
		});
	});

	describe('zoom', () => {
		it('omits --min-zoom at the default of 0', () => {
			expect(buildCommand(untouched({ minZoom: 0 }))).not.toContain('--min-zoom');
		});

		it('emits --min-zoom above 0', () => {
			expect(buildCommand(untouched({ minZoom: 5 }))).toContain('--min-zoom 5');
		});

		it('omits --max-zoom when it still covers the whole container', () => {
			expect(buildCommand(untouched({ maxZoom: 14, zoomCeiling: 14 }))).not.toContain('--max-zoom');
		});

		it('emits --max-zoom below the ceiling', () => {
			expect(buildCommand(untouched({ maxZoom: 11, zoomCeiling: 14 }))).toContain('--max-zoom 11');
		});

		it('omits --max-zoom when the ceiling is unknown', () => {
			// Before an index loads there is nothing to compare against, so emitting a
			// limit would silently truncate a download the user never restricted.
			expect(buildCommand(untouched({ maxZoom: 11, zoomCeiling: undefined }))).not.toContain('--max-zoom');
		});

		it('respects a ceiling that is not 14', () => {
			expect(buildCommand(untouched({ maxZoom: 10, zoomCeiling: 10 }))).not.toContain('--max-zoom');
			expect(buildCommand(untouched({ maxZoom: 9, zoomCeiling: 10 }))).toContain('--max-zoom 9');
		});
	});

	describe('docker', () => {
		it('mounts the working directory and writes into it', () => {
			const command = buildCommand(untouched({ tool: 'docker', output: 'osm.pmtiles' }));
			expect(command).toContain('docker run -it --rm -v $(pwd):/data');
			expect(command).toContain('versatiles/versatiles:latest convert');
			expect(command).toContain('"/data/osm.pmtiles"');
		});

		it('leaves the source url unprefixed', () => {
			expect(buildCommand(untouched({ tool: 'docker' }))).toContain(`"${SOURCE}"`);
		});

		it('takes the same flags as the binary', () => {
			const command = buildCommand(untouched({ tool: 'docker', bbox: BERLIN, minZoom: 2, maxZoom: 11 }));
			expect(command).toContain('--bbox 13,52.3,13.8,52.7');
			expect(command).toContain('--min-zoom 2');
			expect(command).toContain('--max-zoom 11');
		});
	});

	it('orders flags before the positional arguments', () => {
		const command = buildCommand(untouched({ bbox: BERLIN, minZoom: 2, maxZoom: 11 }));
		expect(command.indexOf('--bbox')).toBeLessThan(command.indexOf(SOURCE));
		expect(command.indexOf('--max-zoom')).toBeLessThan(command.indexOf(SOURCE));
	});
});
