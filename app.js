/**
 * app.js — Entry point
 *
 * Mode state machine:
 *   'analyze'  — normal analysis view (class tree, methods, calls)
 *   'compare'  — diff view vs a second user-uploaded JAR
 *
 * Compare flow:
 *   1. User flips slider → compare upload overlay appears
 *   2. User drops / selects the reference JAR
 *   3. Overlay hides, diff is computed and rendered
 *   4. Toggling back to ANALYZE restores normal view (diff cached)
 *   5. Toggling back to COMPARE re-uses cached diff immediately
 *
 * Mobile panel state machine (within each mode):
 *   'classes' → 'members' → 'calls'
 */

import { initUploadZone }               from './modules/upload.js';
import { processJar, processJarBuffer } from './modules/jarProcessor.js';
import { renderTree }                   from './modules/fileTree.js';
import { renderMethodTree }             from './modules/methodTree.js';
import { runDetections, runDiffDetections } from './modules/detectionEngine.js';
import { renderDetections }             from './modules/detectionPanel.js';
import { diffClassMaps }                from './modules/diffEngine.js';
import { renderDiffTree, clearDiffTree } from './modules/diffView.js';
import { initModeToggle, setToggleEnabled, setToggleMode } from './modules/modeToggle.js';
import { setProgress, showSection }     from './modules/ui.js';

// ── Global state ──────────────────────────────────────────────────
export const state = {
  classMap:      new Map(),  // uploaded (suspect) plugin
  officialMap:   new Map(),  // reference JAR uploaded by user
  pluginMeta:    null,       // { name, version, source } from plugin.yml
  officialMeta:  null,       // meta from reference JAR
  diffResult:    null,       // cached DiffResult — cleared only on new primary JAR

  mode:          'analyze',
  activePanel:   'classes',
  activeClass:   null,
  activeMethod:  null,
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

document.getElementById('btn-back')?.addEventListener('click', () => {
  if      (state.activePanel === 'calls')   { setPanel('members'); state.activeMethod = null; }
  else if (state.activePanel === 'members') { setPanel('classes'); state.activeClass  = null; }
  updateBreadcrumb();
});

// ── Mode toggle ───────────────────────────────────────────────────

initModeToggle({
  onAnalyze: switchToAnalyze,
  onCompare: switchToCompare,
});
setToggleEnabled(false);

function switchToAnalyze() {
  state.mode = 'analyze';
  document.getElementById('results-section')?.setAttribute('data-mode', 'analyze');
  setCompareStatus('');
  clearDiffTree();
  applyAnalyzeView();
}

function switchToCompare() {
  state.mode = 'compare';
  document.getElementById('results-section')?.setAttribute('data-mode', 'compare');

  // Re-use cached diff if we already ran a comparison
  if (state.diffResult) {
    applyCompareView();
    return;
  }

  // No cached diff — show the reference JAR upload overlay
  showCompareUpload();
}

// ── Compare upload overlay ────────────────────────────────────────

function showCompareUpload() {
  const overlay = document.getElementById('compare-upload-section');
  if (overlay) overlay.classList.remove('hidden');
}

function hideCompareUpload() {
  const overlay = document.getElementById('compare-upload-section');
  if (overlay) overlay.classList.add('hidden');
}

// Wire up the reference JAR drop zone (runs once at startup)
initUploadZone({
  dropZoneId:  'compare-drop-zone',
  fileInputId: 'compare-jar-input',
  onFile: handleReferenceJarFile,
});

async function handleReferenceJarFile(file) {
  hideCompareUpload();
  setCompareStatus(`Parsing reference JAR: ${file.name}…`);

  try {
    const official = await processJar(file, (pct, lbl) => setCompareStatus(lbl));
    state.officialMap  = official.classMap;
    state.officialMeta = official.meta;

    setCompareStatus('Computing diff…');
    state.diffResult = diffClassMaps(state.classMap, state.officialMap);

    // Diff detections appended to existing window.detections
    const allFindings = runDiffDetections(
      state.diffResult,
      state.pluginMeta,
      state.officialMeta,
      null,  // no spigotInfo — user supplied the file manually
    );
    renderDetections(allFindings);

    const { added, removed, modified } = state.diffResult.summary;
    const refName = state.officialMeta?.name
      ? `"${state.officialMeta.name}" (${state.officialMeta.version})`
      : file.name;
    setCompareStatus(`vs ${refName} — ${added} added, ${removed} removed, ${modified} modified`);

    applyCompareView();

  } catch (err) {
    console.error('[compare]', err);
    setCompareStatus(`⚠ Failed to process reference JAR: ${err.message}`, true);
    // Snap back to analyze mode
    setToggleMode('analyze');
    state.mode = 'analyze';
    document.getElementById('results-section')?.setAttribute('data-mode', 'analyze');
    applyAnalyzeView();
  }
}

// ── Compare status bar ────────────────────────────────────────────

function setCompareStatus(msg, isError = false) {
  const bar = document.getElementById('compare-status-bar');
  if (bar) bar.classList.toggle('hidden', !msg);
  const el = document.getElementById('compare-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('compare-status-error', isError);
}

// ── View renderers ────────────────────────────────────────────────

function applyAnalyzeView() {
  state.activeClass  = null;
  state.activeMethod = null;
  setPanel('classes');

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
}

function applyCompareView() {
  state.activeClass  = null;
  state.activeMethod = null;
  setPanel('classes');

  renderDiffTree(state.diffResult, {
    onMethodPanelOpen: (methodName) => {
      state.activeMethod = methodName ?? null;
      if (window.innerWidth < 768) setPanel('calls');
      updateBreadcrumb();
    },
  });
}

// ── Primary JAR upload ────────────────────────────────────────────

initUploadZone({
  dropZoneId:  'drop-zone',
  fileInputId: 'jar-input',
  onFile: handleJarFile,
});

async function handleJarFile(file) {
  try {
    // Reset all comparison state when a new primary JAR is loaded
    state.officialMap  = new Map();
    state.officialMeta = null;
    state.diffResult   = null;
    setToggleMode('analyze');
    state.mode = 'analyze';
    setCompareStatus('');
    hideCompareUpload();

    showSection('progress');
    const result = await processJar(file, setProgress);
    state.classMap   = result.classMap;
    state.pluginMeta = result.meta;

    showSection('results');
    document.getElementById('results-section')?.setAttribute('data-mode', 'analyze');
    document.getElementById('mobile-nav')?.classList.remove('hidden');
    document.getElementById('mode-toggle-wrap')?.classList.remove('hidden');

    updateToggleLabel();
    setToggleEnabled(true);

    const findings = runDetections(state.classMap);
    renderDetections(findings);

    setPanel('classes');
    applyAnalyzeView();

  } catch (err) {
    console.error(err);
    setProgress(0, `Error: ${err.message}`);
  }
}

function updateToggleLabel() {
  const nameEl = document.getElementById('toggle-plugin-name');
  if (!nameEl) return;
  if (state.pluginMeta?.name) {
    nameEl.textContent = state.pluginMeta.name;
    nameEl.classList.remove('hidden');
  } else {
    nameEl.classList.add('hidden');
  }
}
