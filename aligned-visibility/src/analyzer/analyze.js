import * as cheerio from 'cheerio';
import { fetchHtml } from './network.js';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const countWords = (value) => (text(value).match(/\b[\p{L}\p{N}'’-]+\b/gu) || []).length;

function impactRank(impact) {
  return { high: 3, medium: 2, low: 1 }[impact] || 0;
}

function issue({ id, category, title, finding, suggestion, impact = 'medium', confidence = 'high', type = 'detected', fixable = false, points = 0 }) {
  return { id, category, title, finding, suggestion, impact, confidence, type, fixable, points };
}

function parseJsonLd($) {
  const entries = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      entries.push(parsed);
    } catch {
      entries.push({ __invalid: true });
    }
  });
  return entries;
}

function flattenTypes(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenTypes(item, output));
    return output;
  }
  if (typeof value === 'object') {
    if (value['@type']) {
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      output.push(...types.map(String));
    }
    if (value['@graph']) flattenTypes(value['@graph'], output);
  }
  return output;
}

function sentenceStats(bodyText) {
  const sentences = text(bodyText).split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!sentences.length) return { averageWords: 0, longSentenceRatio: 0 };
  const lengths = sentences.map(countWords);
  return {
    averageWords: lengths.reduce((a, b) => a + b, 0) / lengths.length,
    longSentenceRatio: lengths.filter((n) => n > 30).length / lengths.length
  };
}

function buildAnalysis(html, finalUrl) {
  const $ = cheerio.load(html);
  const url = new URL(finalUrl);

  $('script, style, noscript, template, svg').remove();

  const title = text($('title').first().text());
  const metaDescription = text($('meta[name="description"]').attr('content'));
  const canonical = text($('link[rel="canonical"]').attr('href'));
  const robots = text($('meta[name="robots"]').attr('content')).toLowerCase();
  const htmlLang = text($('html').attr('lang'));
  const h1s = $('h1').map((_, el) => text($(el).text())).get().filter(Boolean);
  const h2s = $('h2').map((_, el) => text($(el).text())).get().filter(Boolean);
  const headings = $('h1,h2,h3').map((_, el) => text($(el).text())).get().filter(Boolean);
  const bodyText = text($('body').text());
  const wordCount = countWords(bodyText);
  const paragraphs = $('p').map((_, el) => text($(el).text())).get().filter(Boolean);
  const questionHeadings = headings.filter((h) => /\?$/.test(h));
  const jsonLd = parseJsonLd($);
  const schemaTypes = [...new Set(jsonLd.flatMap((entry) => flattenTypes(entry)))];
  const invalidSchemaBlocks = jsonLd.filter((entry) => entry?.__invalid).length;

  const links = $('a[href]').map((_, el) => $(el).attr('href')).get().filter(Boolean);
  let internalLinks = 0;
  let externalLinks = 0;
  for (const href of links) {
    try {
      const linked = new URL(href, url);
      if (!['http:', 'https:'].includes(linked.protocol)) continue;
      if (linked.hostname === url.hostname) internalLinks += 1;
      else externalLinks += 1;
    } catch {}
  }

  const images = $('img');
  let imagesWithAlt = 0;
  images.each((_, el) => {
    if (text($(el).attr('alt'))) imagesWithAlt += 1;
  });
  const altCoverage = images.length ? imagesWithAlt / images.length : 1;

  const ogTitle = text($('meta[property="og:title"]').attr('content'));
  const ogDescription = text($('meta[property="og:description"]').attr('content'));
  const author = text($('meta[name="author"]').attr('content'));
  const hasAboutSignal = /\babout\b/i.test(bodyText) || links.some((href) => /about/i.test(href));
  const hasContactSignal = /\bcontact\b/i.test(bodyText) || links.some((href) => /contact/i.test(href));
  const hasFaqSignal = schemaTypes.some((t) => /FAQPage/i.test(t)) || /\bfaq\b|frequently asked questions/i.test(bodyText);
  const repeatedHeadings = headings.filter((h, i) => headings.findIndex((x) => x.toLowerCase() === h.toLowerCase()) !== i);
  const longParagraphRatio = paragraphs.length ? paragraphs.filter((p) => countWords(p) > 120).length / paragraphs.length : 0;
  const sentence = sentenceStats(bodyText);

  const issues = [];
  let search = 100;
  let answerability = 100;
  let aiVisibility = 100;
  let humanQuality = 100;

  if (!title) {
    search -= 20;
    issues.push(issue({ id: 'missing-title', category: 'search', title: 'Add a page title', finding: 'No <title> element was detected.', suggestion: 'Write a concise title that names the page topic, product, or organization.', impact: 'high', fixable: true, points: 20 }));
  } else if (title.length < 30 || title.length > 65) {
    search -= 6;
    issues.push(issue({ id: 'title-length', category: 'search', title: 'Tighten the page title', finding: `The title is ${title.length} characters long.`, suggestion: 'Aim for a descriptive title that is concise enough to scan and specific enough to carry context.', impact: 'medium', points: 6 }));
  }

  if (!metaDescription) {
    search -= 15;
    issues.push(issue({ id: 'missing-meta', category: 'search', title: 'Add a meta description', finding: 'No meta description was detected.', suggestion: 'Summarize the page in one useful sentence for searchers. Treat it as a preview, not a keyword container.', impact: 'high', fixable: true, points: 15 }));
  }

  if (h1s.length !== 1) {
    search -= 10;
    issues.push(issue({ id: 'h1-count', category: 'search', title: h1s.length ? 'Clarify the primary heading' : 'Add a primary heading', finding: `Detected ${h1s.length} H1 headings.`, suggestion: 'Use one clear H1 for the page’s primary subject, then organize supporting sections beneath it.', impact: 'high', points: 10 }));
  }

  if (!canonical) {
    search -= 6;
    issues.push(issue({ id: 'canonical', category: 'search', title: 'Declare the canonical URL', finding: 'No canonical link element was detected.', suggestion: 'Add a canonical URL so duplicate or parameterized versions point back to the preferred page.', impact: 'medium', fixable: true, points: 6 }));
  }

  if (/noindex/.test(robots)) {
    search -= 35;
    issues.push(issue({ id: 'noindex', category: 'search', title: 'This page is marked noindex', finding: 'The robots meta tag contains noindex.', suggestion: 'Keep noindex only if excluding this page from search is intentional.', impact: 'high', points: 35 }));
  }

  if (!htmlLang) {
    search -= 4;
    humanQuality -= 2;
    issues.push(issue({ id: 'lang', category: 'search', title: 'Set the document language', finding: 'The <html> element has no lang attribute.', suggestion: 'Declare the primary language to help browsers, assistive technology, and crawlers interpret the page.', impact: 'low', fixable: true, points: 4 }));
  }

  if (!internalLinks) {
    search -= 7;
    issues.push(issue({ id: 'internal-links', category: 'search', title: 'Create internal pathways', finding: 'No internal links were detected on this page.', suggestion: 'Link to relevant pages that deepen the topic or move visitors to the next useful step.', impact: 'medium', points: 7 }));
  }

  if (altCoverage < 0.8) {
    humanQuality -= 8;
    search -= 3;
    issues.push(issue({ id: 'image-alt', category: 'human', title: 'Improve image alternative text', finding: `${Math.round(altCoverage * 100)}% of images have non-empty alt text.`, suggestion: 'Add useful alt text to informative images. Leave decorative images intentionally empty rather than stuffing keywords.', impact: 'medium', points: 8 }));
  }

  if (wordCount < 250) {
    answerability -= 18;
    issues.push(issue({ id: 'thin-content', category: 'answerability', title: 'Give the page enough context to answer from', finding: `The visible page contains about ${wordCount} words.`, suggestion: 'If this page is meant to explain a topic or offering, add the essential context a visitor would need to understand it without guessing.', impact: 'high', type: 'assessment', confidence: 'medium', points: 18 }));
  }

  if (!h2s.length && wordCount > 250) {
    answerability -= 12;
    humanQuality -= 5;
    issues.push(issue({ id: 'section-structure', category: 'answerability', title: 'Break the page into answerable sections', finding: 'No H2 section headings were detected.', suggestion: 'Use descriptive section headings that reflect the questions or decisions visitors actually have.', impact: 'medium', points: 12 }));
  }

  if (!questionHeadings.length && !hasFaqSignal && wordCount > 400) {
    answerability -= 8;
    issues.push(issue({ id: 'answer-patterns', category: 'answerability', title: 'Make key answers easier to extract', finding: 'The page has substantial content but few obvious question-and-answer structures.', suggestion: 'Where it fits naturally, add direct question headings or concise definitions so important answers are easy to locate.', impact: 'medium', type: 'assessment', confidence: 'medium', points: 8 }));
  }

  if (!schemaTypes.length) {
    aiVisibility -= 20;
    issues.push(issue({ id: 'schema', category: 'ai', title: 'Add structured data where it is truthful', finding: 'No JSON-LD structured data was detected.', suggestion: 'Add schema that accurately describes the page and entity, such as Organization, Person, Article, Product, or WebSite when applicable.', impact: 'high', fixable: true, points: 20 }));
  }

  if (invalidSchemaBlocks) {
    aiVisibility -= 8;
    issues.push(issue({ id: 'invalid-schema', category: 'ai', title: 'Repair invalid JSON-LD', finding: `${invalidSchemaBlocks} structured-data block(s) could not be parsed as JSON.`, suggestion: 'Validate and repair the JSON-LD before relying on it for machine-readable context.', impact: 'high', points: 8 }));
  }

  const entitySchema = schemaTypes.some((t) => /Organization|Person|LocalBusiness|Product|Service|Article|WebSite/i.test(t));
  if (schemaTypes.length && !entitySchema) {
    aiVisibility -= 8;
    issues.push(issue({ id: 'entity-schema', category: 'ai', title: 'Describe the main entity more explicitly', finding: `Detected schema types: ${schemaTypes.join(', ')}.`, suggestion: 'Consider whether the page should explicitly describe the organization, person, product, service, article, or website it represents.', impact: 'medium', type: 'assessment', confidence: 'medium', points: 8 }));
  }

  if (!ogTitle || !ogDescription) {
    aiVisibility -= 6;
    issues.push(issue({ id: 'open-graph', category: 'ai', title: 'Complete social metadata', finding: 'Open Graph title or description metadata is incomplete.', suggestion: 'Add clear Open Graph metadata so shared and parsed page previews preserve the intended context.', impact: 'low', fixable: true, points: 6 }));
  }

  if (!hasAboutSignal && !hasContactSignal && wordCount > 200) {
    aiVisibility -= 7;
    issues.push(issue({ id: 'entity-context', category: 'ai', title: 'Strengthen entity context', finding: 'The page exposes few obvious About or Contact signals.', suggestion: 'Make it easy to identify who is behind the page and how the organization, person, or product connects to the topic.', impact: 'medium', type: 'assessment', confidence: 'medium', points: 7 }));
  }

  if (externalLinks === 0 && wordCount > 700) {
    aiVisibility -= 5;
    issues.push(issue({ id: 'sources', category: 'ai', title: 'Consider citing useful external sources', finding: 'No external links were detected on a long-form page.', suggestion: 'When you make factual or research-based claims, cite authoritative sources rather than adding citations for appearance alone.', impact: 'low', type: 'assessment', confidence: 'medium', points: 5 }));
  }

  if (longParagraphRatio > 0.25) {
    humanQuality -= 10;
    issues.push(issue({ id: 'long-paragraphs', category: 'human', title: 'Reduce dense text blocks', finding: `${Math.round(longParagraphRatio * 100)}% of paragraphs exceed 120 words.`, suggestion: 'Break dense sections where the idea naturally changes. Optimize for comprehension, not arbitrary paragraph length.', impact: 'medium', type: 'assessment', confidence: 'medium', points: 10 }));
  }

  if (sentence.longSentenceRatio > 0.3) {
    humanQuality -= 8;
    issues.push(issue({ id: 'long-sentences', category: 'human', title: 'Review sentence density', finding: `${Math.round(sentence.longSentenceRatio * 100)}% of detected sentences exceed 30 words.`, suggestion: 'Review the densest sentences for clarity. Keep long sentences when the rhythm or meaning benefits from them.', impact: 'low', type: 'assessment', confidence: 'low', points: 8 }));
  }

  if (repeatedHeadings.length) {
    humanQuality -= 5;
    issues.push(issue({ id: 'duplicate-headings', category: 'human', title: 'Differentiate repeated headings', finding: `Repeated heading text detected: ${[...new Set(repeatedHeadings)].slice(0, 3).join(', ')}.`, suggestion: 'Use headings that help a reader predict what is different about each section.', impact: 'low', points: 5 }));
  }

  if (!author && /Article|BlogPosting|NewsArticle/i.test(schemaTypes.join(' '))) {
    aiVisibility -= 6;
    issues.push(issue({ id: 'author', category: 'ai', title: 'Make authorship explicit', finding: 'Article-like schema is present, but a simple author signal was not detected in page metadata.', suggestion: 'Expose truthful authorship information in the visible page and structured data when relevant.', impact: 'medium', type: 'assessment', confidence: 'medium', points: 6 }));
  }

  const scores = {
    search: clamp(search),
    answerability: clamp(answerability),
    aiVisibility: clamp(aiVisibility),
    humanQuality: clamp(humanQuality)
  };
  const overall = Math.round((scores.search + scores.answerability + scores.aiVisibility + scores.humanQuality) / 4);

  issues.sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || b.points - a.points);

  return {
    url: finalUrl,
    scannedAt: new Date().toISOString(),
    overall,
    scores,
    summary: {
      title,
      metaDescription,
      canonical,
      h1s,
      wordCount,
      internalLinks,
      externalLinks,
      imageCount: images.length,
      altCoverage: Math.round(altCoverage * 100),
      schemaTypes,
      questionHeadings: questionHeadings.length
    },
    issues,
    methodology: {
      detected: 'Directly observed in the fetched HTML.',
      assessment: 'Heuristic interpretation. Treat as a prompt for human review, not a search-engine rule.'
    }
  };
}

export async function analyzeUrl(inputUrl) {
  const page = await fetchHtml(inputUrl);
  return buildAnalysis(page.html, page.finalUrl);
}

export { buildAnalysis };
