import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysis } from './analyze.js';

test('scores a well-structured sample higher than a sparse sample', () => {
  const strong = buildAnalysis(`<!doctype html><html lang="en"><head>
    <title>Example Studio | Responsible AI Strategy for Teams</title>
    <meta name="description" content="Example Studio helps teams adopt responsible AI with clear strategy, governance, and human review." />
    <link rel="canonical" href="https://example.com/" />
    <meta property="og:title" content="Example Studio" />
    <meta property="og:description" content="Responsible AI strategy for teams" />
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example Studio"}</script>
  </head><body>
    <h1>Responsible AI strategy for teams</h1>
    <h2>What is responsible AI strategy?</h2>
    <p>${'Clear useful context for visitors and machines. '.repeat(50)}</p>
    <a href="/about">About</a><a href="/contact">Contact</a><a href="https://www.nist.gov/">Source</a>
  </body></html>`, 'https://example.com/');

  const sparse = buildAnalysis('<html><head></head><body><div>Hi</div></body></html>', 'https://example.com/');

  assert.ok(strong.overall > sparse.overall);
  assert.equal(sparse.summary.h1s.length, 0);
  assert.ok(sparse.issues.some((item) => item.id === 'missing-title'));
});
