import express from 'express';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

process.chdir(dirname(import.meta.dirname));

const app = express();

app.get('/update', (req, res) => {
  res.status(200);
  const cp = spawn('./scripts/update.sh');
  cp.stdout.on('data', chunk => res.write(chunk));
  cp.stderr.on('data', chunk => res.write(chunk));
  cp.on('close', () => res.end())
})
