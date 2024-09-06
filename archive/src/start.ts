import { purgeCache, updateEdgeRules } from './lib/bunny_cdn.js';
import { getFileList, upload } from './lib/bunny_storage.js';
import { buildUrlList, getLatestFileRedirects } from './lib/files.js';
import { buildPage } from './lib/page.js';

console.log('get file list');
const files = await getFileList();
console.log('get latest file redirects');
const latest = getLatestFileRedirects(files);

console.log('update edge rules');
await updateEdgeRules(latest);

console.log('build page');
const page = buildPage(files);
console.log('upload page');
await upload(page, 'index.html', 'text/html');

console.log('build url list');
const list = await buildUrlList(latest);
console.log('upload url list');
await upload(list, 'urllist.tsv', 'text/plain');

console.log('purge cache');
await purgeCache(['', 'index.html', 'urllist.tsv']);
