# Aligned Visibility

A reusable MVP for a free SEO + AI visibility analyzer with a human-review-first product model.

## What V0.1 does

Paste a public URL and receive four scores:

- **Search** — title, description, headings, canonical, indexability, internal links, language, image alt coverage.
- **Answerability** — content depth, section structure, obvious answer patterns.
- **AI visibility** — structured data, entity context, social metadata, source signals.
- **Human quality** — dense paragraphs, long-sentence heuristics, duplicate headings, accessibility signals.

The analyzer explicitly labels findings as either:

- `detected`: directly observed in the fetched HTML.
- `assessment`: heuristic interpretation that should be reviewed by a person.

## Product principle

**Machines may recommend. Humans approve. Nothing publishes itself.**

The free tier diagnoses. The next paid layer should create editable proposed changes, show a before/after diff, collect approval, then push only approved changes through a connector such as GitHub.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API

`POST /api/analyze`

```json
{ "url": "https://example.com" }
```

## Security notes

The scanner blocks localhost/private IP ranges, validates every redirect hop, limits scan size, restricts protocols, checks returned content type, and times out slow requests. These controls matter because a URL scanner can otherwise become an SSRF proxy.

Before production, also add:

- rate limiting and abuse protection
- request logging with privacy-conscious retention
- queueing for scans
- caching
- explicit robots/crawl policy
- stricter DNS rebinding protection at the infrastructure layer
- production error monitoring

## Suggested next build: Fix Mode

1. Map deterministic issues to patch generators.
2. Add an optional model layer for semantic recommendations.
3. Save recommendations as a reviewable change set.
4. Show current vs proposed content/code.
5. Require explicit approval per change.
6. Connect a GitHub repository.
7. Create a branch and pull request containing only approved changes.
8. Re-scan the preview or deployed page to verify the change.

## Repo structure

```text
src/
  analyzer/
    analyze.js       # scoring + checks
    network.js       # safe page fetching
  server.js          # API + static app
public/
  index.html
  app.js
  styles.css
```

## License

Choose a license before publishing the repository. If the analyzer methodology is part of a commercial product strategy, consider whether you want MIT, source-available, or private code before making the repo public.
