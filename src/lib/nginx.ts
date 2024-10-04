/*

5. **Generate NGINX Configuration**:
   - Create `location` blocks in the NGINX configuration for:
     - **Local Files**:
       ```nginx
       location /downloads/latest/ {
           alias /path/to/local/files/;
       }
       ```
     - **Remote Files**:
       ```nginx
       location /downloads/ {
           proxy_pass http://cloud.storage.url/;
       }
       ```
     - **HTML File List**:
       ```nginx
       location / {
           root /path/to/html/files/;
           index index.html;
       }
       ```
     - **Webhook URL**:
       ```nginx
       location /webhook/SECRET_STRING/ {
           proxy_pass http://localhost:port/;
       }
       ```
   - Apply the new configuration by updating the NGINX config files.
*/

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Handlebars from 'handlebars';
import { FileRef } from './file_ref.js';

export function generateNGINX(files: FileRef[], filename: string): FileRef {
  console.log('generate nginx conf');

  const templateFilename = resolve(import.meta.dirname, '../../template/nginx.conf');
  const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
  const html = template({ files });
  writeFileSync(filename, html);

  return new FileRef(filename, '');
}
