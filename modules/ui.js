/**
 * modules/ui.js
 * Small UI utilities: section visibility, progress bar.
 */

const SECTIONS = {
  upload:   'upload-section',
  progress: 'progress-section',
  results:  'results-section',
};

/**
 * Show one section, hide the others.
 * @param {'upload'|'progress'|'results'} name
 */
export function showSection(name) {
  for (const [key, id] of Object.entries(SECTIONS)) {
    const el = document.getElementById(id);
    el.classList.toggle('hidden', key !== name);
  }
}

/**
 * Update the progress bar and label.
 * @param {number} pct   - 0–100
 * @param {string} label - Status text
 */
export function setProgress(pct, label) {
  document.getElementById('progress-bar').style.width   = `${pct}%`;
  document.getElementById('progress-label').textContent = label;
}
