import { updateEdgeRules } from './lib/bunny_cdn.js';
import { getFileList, upload } from './lib/bunny_storage.js';
import { buildUrlList, getLatestFiles } from './lib/files.js';
import { buildPage } from './lib/page.js';


const files = await getFileList();
const latest = getLatestFiles(files);

await updateEdgeRules(latest);

const page = buildPage(files);
await upload(page, 'index.html', 'text/html');

const list = buildUrlList(latest);
await upload(list, 'urllist.tsv', 'text/plain');
