/**
 * modules/detectionPanel.js
 * Renders the detections list into #detections-section.
 * Handles INFO / CAUTIOUS / SUSPICIOUS / SEVERE severity levels.
 */

const SEV = {
  SEVERE:     { label: 'SEVERE',     cls: 'sev-severe',     icon: '✕' },
  SUSPICIOUS: { label: 'SUSPICIOUS', cls: 'sev-suspicious', icon: '⚠' },
  CAUTIOUS:   { label: 'CAUTIOUS',   cls: 'sev-cautious',   icon: '◈' },
  INFO:       { label: 'INFO',       cls: 'sev-info',       icon: 'ℹ' },
};

export function renderDetections(detections) {
  const section = document.getElementById('detections-section');
  const badge   = document.getElementById('detection-badge');
  const countEl = document.getElementById('detection-count');
  const listEl  = document.getElementById('detection-list');

  if (!section) return;
  section.classList.remove('hidden');

  const total   = detections.length;
  const hasSev  = detections.some(d => d.severity === 'SEVERE');
  const hasSusp = detections.some(d => d.severity === 'SUSPICIOUS');
  const hasCaut = detections.some(d => d.severity === 'CAUTIOUS');

  let verdict, verdictCls;
  if      (hasSev)          { verdict = 'SEVERE';      verdictCls = 'verdict-severe'; }
  else if (hasSusp)         { verdict = 'SUSPICIOUS';  verdictCls = 'verdict-suspicious'; }
  else if (hasCaut)         { verdict = 'CAUTIOUS';    verdictCls = 'verdict-cautious'; }
  else if (total === 0)     { verdict = 'CLEAN';       verdictCls = 'verdict-clean'; }
  else                      { verdict = 'INFO';        verdictCls = 'verdict-info'; }

  if (badge) {
    badge.textContent = verdict;
    badge.className   = `detection-verdict ${verdictCls}`;
  }
  if (countEl) countEl.textContent = total === 0
    ? 'no findings'
    : `${total} finding${total !== 1 ? 's' : ''}`;

  if (!listEl) return;
  listEl.innerHTML = '';

  if (total === 0) {
    listEl.innerHTML = '<li class="det-empty">No suspicious indicators found.</li>';
    return;
  }

  for (const sev of ['SEVERE', 'SUSPICIOUS', 'CAUTIOUS', 'INFO']) {
    const group = detections.filter(d => d.severity === sev);
    if (group.length === 0) continue;
    const cfg = SEV[sev];

    const header = document.createElement('li');
    header.className = `det-group-header det-group-${sev.toLowerCase()}`;
    header.innerHTML = `
      <span class="det-group-icon">▸</span>
      <span class="det-group-label ${cfg.cls}">${cfg.label}</span>
      <span class="det-group-count">${group.length}</span>`;
    listEl.appendChild(header);

    for (const det of group) {
      const li = document.createElement('li');
      li.className = 'det-item';

      // source can be a short list of locations — render as tooltip title
      const titleAttr = det.source ? ` title="${esc(det.source)}"` : '';
      const sourceHtml = det.source
        ? `<span class="det-source">${esc(shortSource(det.source))}</span>`
        : '';

      li.innerHTML = `
        <span class="det-icon ${cfg.cls}">${cfg.icon}</span>
        <span class="det-body"${titleAttr}>
          <span class="det-message">${esc(det.message)}</span>
          ${sourceHtml}
        </span>`;
      listEl.appendChild(li);
    }
  }
}

function shortSource(source) {
  const hashIdx = source.indexOf('#');
  if (hashIdx >= 0) {
    const cls    = source.slice(0, hashIdx).split('.').pop();
    const method = source.slice(hashIdx + 1);
    return `${cls}#${method}`;
  }
  // May be a semicolon-separated list of locations (from ADDED_CALLS rule)
  if (source.includes(';')) return source.split(';')[0].trim() + '…';
  return source.split('.').pop() || source;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
