import express from 'express';
import { run } from './lib/run.js';

const app = express();

app.get('/update', (_req, res) => {
	run();
	res.status(200).end();
})

app.listen(80);
