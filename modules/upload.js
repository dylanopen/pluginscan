/**
 * modules/upload.js
 * Handles drag-and-drop and file-input interactions.
 * Calls onFile(File) when a .jar is selected.
 */

/**
 * @param {object} opts
 * @param {string}   opts.dropZoneId  - ID of the drop zone element
 * @param {string}   opts.fileInputId - ID of the hidden file input
 * @param {function} opts.onFile      - Callback(File) when a jar is ready
 */
export function initUploadZone({ dropZoneId, fileInputId, onFile }) {
  const zone  = document.getElementById(dropZoneId);
  const input = document.getElementById(fileInputId);

  // ── File input change ──────────────────────────────────────────
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) dispatchFile(file, onFile);
  });

  // ── Click on zone opens file picker ───────────────────────────
  zone.addEventListener('click', () => input.click());

  // ── Drag events ────────────────────────────────────────────────
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) dispatchFile(file, onFile);
  });
}

// ── Internal helpers ──────────────────────────────────────────────

function dispatchFile(file, onFile) {
  if (!file.name.endsWith('.jar')) {
    alert('Please select a .jar file.');
    return;
  }
  onFile(file);
}
