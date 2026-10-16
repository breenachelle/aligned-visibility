import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export function normalizeUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Enter a URL to analyze.');

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not supported.');
  return url;
}

async function assertPublicHost(url) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Local or private network addresses cannot be scanned.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Private network addresses cannot be scanned.');
    return;
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error('This hostname resolves to a private or unsupported network address.');
  }
}

async function readLimitedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('The page is too large to scan in the free analyzer.');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

export async function fetchHtml(inputUrl) {
  let current = normalizeUrl(inputUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'AlignedVisibilityBot/0.1 (+human-reviewed SEO analyzer)',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The page took too long to respond.');
      throw new Error(`Could not fetch the page: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`The page redirected without a destination (${response.status}).`);
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) throw new Error(`The page returned HTTP ${response.status}.`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('The URL did not return an HTML page.');
    }

    const html = await readLimitedText(response);
    return {
      html,
      finalUrl: current.toString(),
      status: response.status,
      contentType
    };
  }

  throw new Error('Too many redirects.');
}
