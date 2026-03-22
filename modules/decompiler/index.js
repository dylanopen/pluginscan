/**
 * modules/decompiler/index.js
 * ─────────────────────────────────────────────────────────────────
 * Public API for the decompiler layer.
 *
 * HOW TO SWAP IN A DIFFERENT DECOMPILER
 * ──────────────────────────────────────
 * 1. Create a new file under modules/decompiler/ (e.g. fernflower.js)
 *    that exports:  async function decompile(bytes, className): string
 * 2. Change the import below to point at your new file.
 * 3. Everything else (jarProcessor, UI) stays the same.
 *
 * Current backend: bytecodeDisassembler.js  (pure-JS, no WASM needed)
 * Possible alternatives:
 *   - cfr.js          (CFR via CheerpJ / WASM)
 *   - fernflower.js   (Fernflower via WASM)
 *   - procyon.js      (Procyon via WASM)
 *   - remoteApi.js    (POST bytes to a server-side decompiler API)
 */

export { decompile } from './jarTools.js';
