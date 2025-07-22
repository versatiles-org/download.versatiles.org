import { readFileSync, writeFileSync } from 'fs';
import Handlebars from 'handlebars';
import { FileRef } from '../file/file_ref.js';
import { FileResponse } from '../file/file_response.js';

// Function to generate NGINX configuration
export function buildNginxConf(files: FileRef[], responses: FileResponse[]): string {
	const templateFilename = new URL('../../../template/nginx.conf', import.meta.url).pathname;
	const templateContent = readFileSync(templateFilename, 'utf-8');
	const template = Handlebars.compile(templateContent);

	const webhook = process.env['WEBHOOK'];

	files.sort((a, b) => a.url.localeCompare(b.url));
	responses.sort((a, b) => a.url.localeCompare(b.url));

	// Compile the NGINX configuration using Handlebars and the provided files
	return template({ files, responses, webhook });
}

// Function to generate NGINX configuration
export function generateNginxConf(files: FileRef[], responses: FileResponse[], filename: string): FileRef {
	console.log('Generating NGINX configuration...');

	// Write the generated configuration to the specified filename
	writeFileSync(filename, buildNginxConf(files, responses));
	console.log(' - Configuration successfully written');

	// Return a new FileRef for the generated config file
	return new FileRef(filename, '');
}
