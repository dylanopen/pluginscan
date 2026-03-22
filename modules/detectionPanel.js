/**
 * modules/detectionPanel.js
 * ─────────────────────────────────────────────────────────────────
 * Renders the detections list into #detections-section.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ SCAN RESULTS  [N findings]    [CLEAN/CAUTIOUS/…] │
 *   ├──────────────────────────────────────────────────┤
 *   │ ▸ SEVERE (N)                                     │
 *   │     ⬡  message               source              │
 *   │ ▸ SUSPICIOUS (N)                                 │
 *   │     …                                            │
 *   │ ▸ CAUTIOUS (N)                                   │
 *   │     …                                            │
 *   └──────────────────────────────────────────────────┘
 *
 * Public API:
 *   renderDetections(detections: Detection[])
 */

// Severity display config
const SEV = {
  SEVERE:     { label: 'SEVERE',     cls: 'sev-severe',     icon: '✕' },
  SUSPICIOUS: { label: 'SUSPICIOUS', cls: 'sev-suspicious', icon: '⚠' },
  CAUTIOUS:   { label: 'CAUTIOUS',   cls: 'sev-cautious',   icon: '◈' },
};

/**
 * @param {import('./detectionEngine.js').Detection[]} detections
 */
export function renderDetections(detections) {
  const section  = document.getElementById('detections-section');
  const badge    = document.getElementById('detection-badge');
  const countEl  = document.getElementById('detection-count');
  const listEl   = document.getElementById('detection-list');

  if (!section) return;

  // Always show the section once a scan completes
  section.classList.remove('hidden');

  const total    = detections.length;
  const hasSev   = detections.some(d => d.severity === 'SEVERE');
  const hasSusp  = detections.some(d => d.severity === 'SUSPICIOUS');

  // Overall verdict badge
  let verdict, verdictCls;
  if (total === 0)      { verdict = 'CLEAN';       verdictCls = 'verdict-clean'; }
  else if (hasSev)      { verdict = 'SEVERE';       verdictCls = 'verdict-severe'; }
  else if (hasSusp)     { verdict = 'SUSPICIOUS';   verdictCls = 'verdict-suspicious'; }
  else                  { verdict = 'CAUTIOUS';      verdictCls = 'verdict-cautious'; }

  if (badge) {
    badge.textContent = verdict;
    badge.className   = `detection-verdict ${verdictCls}`;
  }
  if (countEl) countEl.textContent = total === 0 ? 'no findings' : `${total} finding${total !== 1 ? 's' : ''}`;

  if (!listEl) return;
  listEl.innerHTML = '';

  if (total === 0) {
    listEl.innerHTML = '<li class="det-empty">No suspicious indicators found.</li>';
    return;
  }

  // Group by severity in display order
  for (const sev of ['SEVERE', 'SUSPICIOUS', 'CAUTIOUS']) {
    const group = detections.filter(d => d.severity === sev);
    if (group.length === 0) continue;

    const cfg = SEV[sev];

    // Group header
    const header = document.createElement('li');
    header.className = `det-group-header det-group-${sev.toLowerCase()}`;
    header.innerHTML = `
      <span class="det-group-icon">▸</span>
      <span class="det-group-label ${cfg.cls}">${cfg.label}</span>
      <span class="det-group-count">${group.length}</span>`;
    listEl.appendChild(header);

    // Items
    for (const det of group) {
      const li = document.createElement('li');
      li.className = 'det-item';
      li.title     = det.source ? `Source: ${det.source}` : '';

      const sourceHtml = det.source
        ? `<span class="det-source">${esc(shortSource(det.source))}</span>`
        : '';

      li.innerHTML = `
        <span class="det-icon ${cfg.cls}">${cfg.icon}</span>
        <span class="det-body">
          <span class="det-message">${esc(det.message)}</span>
          ${sourceHtml}
        </span>`;

      listEl.appendChild(li);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/** Shorten "com.example.foo.Bar#method" → "Bar#method" */
function shortSource(source) {
  const hashIdx = source.indexOf('#');
  if (hashIdx >= 0) {
    const cls    = source.slice(0, hashIdx).split('.').pop();
    const method = source.slice(hashIdx + 1);
    return `${cls}#${method}`;
  }
  return source.split('.').pop() || source;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
