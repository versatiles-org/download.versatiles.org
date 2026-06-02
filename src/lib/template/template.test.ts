import { describe, expect, it, vi } from 'vitest';
import { generateHTML, generateRSSFeeds, renderTemplate } from './template.js';
import { FileGroup } from '../file/file_group.js';

console.log = vi.fn();

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

describe('renderTemplate', () => {
	it('should render Template', () => {
		const result = renderTemplate(fileGroups(), "index.html");
		expect(result).toContain('<html>');
		expect(result).toContain('a group with index 1');
		expect(result).toContain('a group with index 3');
	});
});

describe('generateHTML', () => {
	it('should return an index.html FileResponse', () => {
		const result = generateHTML(fileGroups());
		expect(result.url).toBe('/index.html');
		expect(result.contentType).toBe('text/html');
		expect(result.content).toContain('<html>');
		expect(result.content).toContain('a group with index 1');
	});
});

describe('generateRSSFeeds', () => {
	it('should return one RSS FileResponse per group', () => {
		const result = generateRSSFeeds(fileGroups());
		expect(result.length).toBe(2);
		expect(result[0].url).toBe('/feed-group_1.xml');
		expect(result[1].url).toBe('/feed-group_3.xml');
		expect(result[0].contentType).toBe('application/rss+xml');
	});
});
