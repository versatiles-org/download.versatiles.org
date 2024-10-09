import { readFileSync, writeFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import { FileRef } from '../file/file_ref.js';

// Function to generate NGINX configuration
export function buildNginxConf(files: FileRef[]): string {
	const templateFilename = new URL('../../../template/nginx.conf', import.meta.url).pathname;
	const templateContent = readFileSync(templateFilename, 'utf-8');
	const template = Handlebars.compile(templateContent);

	const webhook = process.env['WEBHOOK'];

	// Compile the NGINX configuration using Handlebars and the provided files
	return template({ files, webhook });
}

// Function to generate NGINX configuration
export function generateNginxConf(files: FileRef[], filename: string): FileRef {
	console.log('Generating NGINX configuration...');

	// Write the generated configuration to the specified filename
	writeFileSync(filename, buildNginxConf(files));
	console.log(' - Configuration successfully written');

	// Return a new FileRef for the generated config file
	return new FileRef(filename, '');
}
