/**
 * app.js — Entry point
 *
 * Desktop: 3-column analysis grid + detections panel below.
 * Mobile:  Single column with panel state machine.
 *          Panels: classes → members → calls
 *          Detections always visible below the grid on desktop;
 *          accessible via a 4th mobile panel state.
 */

import { initUploadZone }             from './modules/upload.js';
import { processJar }                 from './modules/jarProcessor.js';
import { renderTree }                 from './modules/fileTree.js';
import { renderMethodTree }           from './modules/methodTree.js';
import { runDetections }              from './modules/detectionEngine.js';
import { renderDetections }           from './modules/detectionPanel.js';
import { setProgress, showSection }   from './modules/ui.js';

// ── State ─────────────────────────────────────────────────────────
export const state = {
  classMap:     new Map(),
  activePanel:  'classes',
  activeClass:  null,
  activeMethod: null,
};

// ── Mobile panel switching ────────────────────────────────────────

const LAYOUT = document.querySelector('.results-layout');

function setPanel(panel) {
  state.activePanel = panel;
  if (LAYOUT) LAYOUT.dataset.panel = panel;
  updateBreadcrumb();
}

function updateBreadcrumb() {
  const crumbClass     = document.getElementById('crumb-class');
  const crumbClassSep  = document.getElementById('crumb-class-sep');
  const crumbMethod    = document.getElementById('crumb-method');
  const crumbMethodSep = document.getElementById('crumb-method-sep');
  const btnBack        = document.getElementById('btn-back');
  const mobileNav      = document.getElementById('mobile-nav');

  if (!crumbClass) return;

  mobileNav?.classList.toggle('hidden', !state.activeClass && state.activePanel === 'classes');

  crumbClass.textContent  = state.activeClass  ?? '';
  crumbMethod.textContent = state.activeMethod ?? '';

  crumbClass.classList.toggle('hidden',      !state.activeClass);
  crumbClassSep?.classList.toggle('hidden',  !state.activeClass);
  crumbMethod.classList.toggle('hidden',     !state.activeMethod);
  crumbMethodSep?.classList.toggle('hidden', !state.activeMethod);

  btnBack?.classList.toggle('hidden', state.activePanel === 'classes');
}

// Back button — steps backwards through the panel stack
document.getElementById('btn-back')?.addEventListener('click', () => {
  if      (state.activePanel === 'calls')   { setPanel('members'); state.activeMethod = null; }
  else if (state.activePanel === 'members') { setPanel('classes'); state.activeClass  = null; }
  else if (state.activePanel === 'detections') setPanel('classes');
  updateBreadcrumb();
});

// ── Bootstrap ─────────────────────────────────────────────────────
initUploadZone({
  dropZoneId:  'drop-zone',
  fileInputId: 'jar-input',
  onFile: handleJarFile,
});

// ── Core flow ─────────────────────────────────────────────────────
async function handleJarFile(file) {
  try {
    showSection('progress');
    state.classMap = await processJar(file, setProgress);
    showSection('results');

    document.getElementById('mobile-nav')?.classList.remove('hidden');
    setPanel('classes');

    // ── Run detections across the full classMap ───────────────────
    const findings = runDetections(state.classMap);
    renderDetections(findings);

    // ── Wire up the class tree ────────────────────────────────────
    renderTree(state.classMap, (className) => {
      state.activeClass  = className.split('.').pop();
      state.activeMethod = null;

      const info = state.classMap.get(className);
      renderMethodTree(info, {
        onMethodPanelOpen: (methodName) => {
          state.activeMethod = methodName ?? null;
          if (window.innerWidth < 768) setPanel('calls');
          updateBreadcrumb();
        },
      });

      if (window.innerWidth < 768) setPanel('members');
      updateBreadcrumb();
    });

  } catch (err) {
    console.error(err);
    setProgress(0, `Error: ${err.message}`);
  }
}
