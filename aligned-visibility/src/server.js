import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeUrl } from './analyzer/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.post('/api/analyze', async (req, res) => {
  try {
    const result = await analyzeUrl(req.body?.url);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to analyze this URL.' });
  }
});

app.listen(port, () => {
  console.log(`Aligned Visibility running at http://localhost:${port}`);
});
