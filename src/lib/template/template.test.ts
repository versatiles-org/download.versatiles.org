import { describe, expect, it, vi } from 'vitest';
import { generateRSSFeeds, renderTemplate } from './template.js';
import { FileGroup } from '../file/file_group.js';
import { tmpdir } from 'os';

console.log = vi.fn();

describe('renderTemplate', () => {
	function fileGroups(): FileGroup[] {
		return [1, 3].map(i => new FileGroup({
			slug: 'group_' + i,
			title: 'Group ' + i,
			desc: 'a group with index ' + i,
			order: i * 10,
			local: false,
			olderFiles: []
		}));
	}

	it('should render Template', () => {
		const result = renderTemplate(fileGroups(), "index.html");
		expect(result).toContain('<html>');
		expect(result).toContain('a group with index 1');
		expect(result).toContain('a group with index 3');
	});

	it('should generate RSS', () => {
		const result = generateRSSFeeds(fileGroups(), tmpdir());
		expect(result.length).toBe(2);
		expect(result[0].filename).toBe("feed-group_1.xml");
		expect(result[1].filename).toBe("feed-group_3.xml");
	});
});
