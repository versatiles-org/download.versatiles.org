import { readFileSync, writeFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import { FileRef } from './file_ref.js';

// Function to generate NGINX configuration
export function generateNGINX(files: FileRef[], domain: string, filename: string): FileRef {
	console.log('Generating NGINX configuration...');

	const templateFilename = new URL('../../template/nginx.conf', import.meta.url).pathname;
	const templateContent = readFileSync(templateFilename, 'utf-8');
	const template = Handlebars.compile(templateContent);

	// Compile the NGINX configuration using Handlebars and the provided files
	const nginxConfig = template({ files, domain });

	// Write the generated configuration to the specified filename
	writeFileSync(filename, nginxConfig);
	console.log(' - Configuration successfully written');

	// Return a new FileRef for the generated config file
	return new FileRef(filename, '');
}
