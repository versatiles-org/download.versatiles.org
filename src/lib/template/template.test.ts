import { renderTemplate } from './template.js';
import { FileGroup } from '../file/file_group.js';

describe('renderTemplate', () => {

	test('should build HTML using the Handlebars template', () => {
		const fileGroups = [group(1), group(2)];
		const result = renderTemplate(fileGroups, "index.html");
		expect(result).toContain('<html>');
		expect(result).toContain('a group with index 1');
		expect(result).toContain('a group with index 2');
	});

	function group(index: number): FileGroup {
		return new FileGroup({
			slug: 'group_' + index,
			title: 'Group ' + index,
			desc: 'a group with index ' + index,
			order: index * 10,
			local: false,
			olderFiles: []
		})
	}
});
