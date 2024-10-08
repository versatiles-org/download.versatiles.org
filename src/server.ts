import express from 'express';
import { run } from './lib/run.js';

await run();

const app = express();

app.get('/update', async (_req, res) => {
	await run();
	res.status(200).end();
})

app.listen(80);

process.on('SIGINT', () => {
	console.info("Interrupted")
	process.exit(0)
})
