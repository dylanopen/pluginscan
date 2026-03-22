/**
 * modules/modeToggle.js
 * ─────────────────────────────────────────────────────────────────
 * Manages the ANALYZE ↔ COMPARISON slider toggle.
 *
 * The toggle is a pill-style slider:
 *   [ ANALYZE  ●──────]   →  analysis mode
 *   [──────●  COMPARE ]   →  comparison mode
 *
 * Public API:
 *   initModeToggle({ onAnalyze, onCompare })
 *     onAnalyze()  — called when switching back to analyze mode
 *     onCompare()  — called when switching to comparison mode
 *
 *   setToggleEnabled(bool)   — enable/disable the toggle
 *   setToggleMode('analyze'|'compare')  — programmatic switch
 *   getCurrentMode() → 'analyze'|'compare'
 */

let _currentMode = 'analyze';
let _onAnalyze   = () => {};
let _onCompare   = () => {};

export function initModeToggle({ onAnalyze, onCompare } = {}) {
  _onAnalyze = onAnalyze ?? (() => {});
  _onCompare = onCompare ?? (() => {});

  const toggle = document.getElementById('mode-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    if (toggle.dataset.disabled === 'true') return;
    const next = _currentMode === 'analyze' ? 'compare' : 'analyze';
    setToggleMode(next);
    if (next === 'analyze') _onAnalyze();
    else                    _onCompare();
  });
}

export function setToggleEnabled(enabled) {
  const toggle = document.getElementById('mode-toggle');
  if (!toggle) return;
  toggle.dataset.disabled = enabled ? 'false' : 'true';
  toggle.classList.toggle('toggle-disabled', !enabled);
}

export function setToggleMode(mode) {
  _currentMode = mode;
  const toggle = document.getElementById('mode-toggle');
  if (!toggle) return;

  toggle.dataset.mode = mode;
  const labelAnalyze = toggle.querySelector('.toggle-label-analyze');
  const labelCompare = toggle.querySelector('.toggle-label-compare');

  if (mode === 'compare') {
    toggle.classList.add('toggle-active');
    if (labelAnalyze) labelAnalyze.classList.remove('toggle-label-current');
    if (labelCompare) labelCompare.classList.add('toggle-label-current');
  } else {
    toggle.classList.remove('toggle-active');
    if (labelAnalyze) labelAnalyze.classList.add('toggle-label-current');
    if (labelCompare) labelCompare.classList.remove('toggle-label-current');
  }
}

export function getCurrentMode() {
  return _currentMode;
}
