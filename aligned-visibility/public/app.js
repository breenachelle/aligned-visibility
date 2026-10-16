const form = document.querySelector('#scan-form');
const input = document.querySelector('#url');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const template = document.querySelector('#results-template');

const scoreLabels = {
  search: ['Search', 'Can search engines parse the essentials?'],
  answerability: ['Answerability', 'Can important answers be located quickly?'],
  aiVisibility: ['AI visibility', 'Is the page context explicit and machine-readable?'],
  humanQuality: ['Human quality', 'Does the page remain useful and readable?']
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function scoreCopy(score) {
  if (score >= 85) return 'Strong foundation. Focus on the few changes that make the page easier to understand.';
  if (score >= 70) return 'Good foundation. A few gaps are making the page work harder than it needs to.';
  if (score >= 50) return 'The page is findable, but important context and structure are getting lost.';
  return 'There are meaningful discoverability gaps. Start with the high-impact items before polishing details.';
}

function render(data) {
  results.innerHTML = '';
  results.append(template.content.cloneNode(true));
  results.classList.remove('hidden');

  results.querySelector('#overall-score').textContent = data.overall;
  results.querySelector('#score-copy').textContent = scoreCopy(data.overall);
  const urlLink = results.querySelector('#scanned-url');
  urlLink.href = data.url;
  urlLink.textContent = data.url;

  const grid = results.querySelector('#score-grid');
  grid.innerHTML = Object.entries(data.scores).map(([key, score]) => {
    const [label, description] = scoreLabels[key];
    return `<article class="score-card">
      <div class="score-card-top"><h3>${escapeHtml(label)}</h3><strong>${score}</strong></div>
      <div class="meter"><span style="width:${score}%"></span></div>
      <p>${escapeHtml(description)}</p>
    </article>`;
  }).join('');

  const issues = results.querySelector('#issues');
  if (!data.issues.length) {
    issues.innerHTML = '<article class="issue"><h3>No major issues detected in this first-pass scan.</h3><p>A deeper content and query-level assessment may still surface opportunities.</p></article>';
    return;
  }

  issues.innerHTML = data.issues.slice(0, 12).map((item, index) => `
    <article class="issue">
      <div class="issue-meta">
        <span class="impact ${escapeHtml(item.impact)}">${escapeHtml(item.impact)} impact</span>
        <span class="type">${escapeHtml(item.type)}</span>
        <span class="confidence">${escapeHtml(item.confidence)} confidence</span>
      </div>
      <div class="issue-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="issue-copy">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="finding">${escapeHtml(item.finding)}</p>
        <p>${escapeHtml(item.suggestion)}</p>
        ${item.fixable ? '<span class="fixable">Can become an approved code change in Fix Mode</span>' : ''}
      </div>
    </article>
  `).join('');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url) return;

  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Scanning…';
  results.classList.add('hidden');
  status.classList.remove('hidden', 'error');
  status.textContent = 'Checking page structure, metadata, machine-readable context, and human readability…';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan failed.');
    status.classList.add('hidden');
    render(data);
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Analyze my page';
  }
});
