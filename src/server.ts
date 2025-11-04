import express from 'express';
import { run } from './lib/run.js';

export const app = express();

app.get('/update', async (_req, res) => {
	res.status(200).end('updating');
	console.log('updating');
	await run();
	console.log('restarting');
	process.exit(0);
})

if (process.env['NODE_ENV'] !== 'test') {
	app.listen(8080,
		() => console.log('listening on http://localhost:8080/')
	);
}

process.on('SIGINT', () => {
	console.info("Interrupted")
	process.exit(0)
})
