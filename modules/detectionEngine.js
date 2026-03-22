/**
 * modules/detectionEngine.js
 * ─────────────────────────────────────────────────────────────────
 * Central detection registry and rule engine.
 *
 * Global state:
 *   window.detections  — Array<Detection>  (always accessible)
 *
 * Public API:
 *   clearDetections()
 *   addDetection(detection)
 *   runDetections(classMap)                    → Array<Detection>
 *   runDiffDetections(diffResult, meta, spigotMeta) → Array<Detection>
 *
 * Severity levels (low → high):
 *   'INFO'       — informational, no threat implied
 *   'CAUTIOUS'   — worth noting; probably benign
 *   'SUSPICIOUS' — warrants manual review
 *   'SEVERE'     — strong indicator of malicious intent
 */

// ── Detection class ───────────────────────────────────────────────

export class Detection {
  /**
   * @param {'INFO'|'CAUTIOUS'|'SUSPICIOUS'|'SEVERE'} severity
   * @param {string} message
   * @param {string} [source]
   * @param {string} [rule]
   */
  constructor(severity, message, source = '', rule = '') {
    this.severity = severity;
    this.message  = message;
    this.source   = source;
    this.rule     = rule;
    this.ts       = Date.now();
    Object.freeze(this);
  }
}

// ── Severity ordering (for sorting) ──────────────────────────────
export const SEVERITY_ORDER = { SEVERE: 0, SUSPICIOUS: 1, CAUTIOUS: 2, INFO: 3 };

// ── Global detections array ───────────────────────────────────────
window.detections = [];

export function clearDetections() {
  window.detections = [];
}

export function addDetection(detection) {
  window.detections.push(detection);
}

// ── Rule runners ──────────────────────────────────────────────────

/**
 * Run static analysis rules on the uploaded classMap.
 * @param {Map<string, ClassInfo>} classMap
 * @returns {Array<Detection>}
 */
export function runDetections(classMap) {
  clearDetections();
  for (const rule of STATIC_RULES) {
    try { rule(classMap); }
    catch (err) { console.warn('[detectionEngine] static rule threw:', err); }
  }
  _sort();
  return window.detections;
}

/**
 * Run diff-based rules after comparison with a reference JAR.
 * Appends to window.detections (does NOT clear first — call after runDetections).
 *
 * @param {import('./diffEngine.js').DiffResult} diffResult
 * @param {{ name:string, version:string }|null}  uploadedMeta  plugin.yml from upload
 * @param {{ name:string, version:string }|null}  officialMeta  plugin.yml from spigot jar
 * @param {{ version: VersionMeta, versionMatched: boolean }} spigotInfo
 * @returns {Array<Detection>}
 */
export function runDiffDetections(diffResult, uploadedMeta, officialMeta, spigotInfo) {
  for (const rule of DIFF_RULES) {
    try { rule(diffResult, uploadedMeta, officialMeta, spigotInfo); }
    catch (err) { console.warn('[detectionEngine] diff rule threw:', err); }
  }
  _sort();
  return window.detections;
}

function _sort() {
  window.detections.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

// ══════════════════════════════════════════════════════════════════
// STATIC RULES  (run on every upload, no comparison needed)
// ══════════════════════════════════════════════════════════════════

const SUSPICIOUS_NAMES = ['compatmodule', 'servicehelper', 'inject'];

const STATIC_RULES = [

  function ruleSuspiciousClassName(classMap) {
    for (const [fqn, info] of classMap) {
      if (info.parseError) continue;
      const simple = fqn.split('.').pop().toLowerCase();
      for (const pattern of SUSPICIOUS_NAMES) {
        if (simple.includes(pattern)) {
          addDetection(new Detection(
            'SUSPICIOUS',
            `Plugin defines class '${fqn}' with suspicious name`,
            fqn, 'SUSPICIOUS_CLASS_NAME',
          ));
          break;
        }
      }
    }
  },

  function ruleSuspiciousMethodName(classMap) {
    for (const [fqn, info] of classMap) {
      if (info.parseError) continue;
      for (const method of info.methods ?? []) {
        const nl = method.name.toLowerCase();
        for (const pattern of SUSPICIOUS_NAMES) {
          if (nl.includes(pattern)) {
            addDetection(new Detection(
              'SUSPICIOUS',
              `Class '${fqn}' defines method '${method.name}' with suspicious name`,
              `${fqn}#${method.name}`, 'SUSPICIOUS_METHOD_NAME',
            ));
            break;
          }
        }
      }
    }
  },

];

// ══════════════════════════════════════════════════════════════════
// DIFF RULES  (run only after comparison with a reference JAR)
// ══════════════════════════════════════════════════════════════════

const DIFF_RULES = [

  // ── Version mismatch ─────────────────────────────────────────────
  // spigotInfo is null when the user supplied the reference JAR manually
  // (which is now always the case). This rule only fires if a caller
  // explicitly passes version-match metadata.
  function ruleVersionMismatch(diffResult, uploadedMeta, officialMeta, spigotInfo) {
    if (!spigotInfo || spigotInfo.versionMatched !== false) return;
    const uploaded = uploadedMeta?.version ?? 'unknown';
    const used     = spigotInfo.version?.name ?? 'unknown';
    addDetection(new Detection(
      'SUSPICIOUS',
      `Declared version "${uploaded}" does not match the reference JAR version "${used}"`,
      '', 'VERSION_MISMATCH',
    ));
  },

  // ── Added classes ────────────────────────────────────────────────
  function ruleAddedClasses(diffResult) {
    const added = [...diffResult.classes.values()].filter(c => c.status === 'added');
    if (added.length === 0) return;
    const names = added.map(c => c.fqn.split('.').pop()).join(', ');
    const sev   = added.length >= 5 ? 'SUSPICIOUS' : 'INFO';
    addDetection(new Detection(
      sev,
      `Plugin contains ${added.length} added class${added.length !== 1 ? 'es' : ''} not present in the reference JAR: ${names}`,
      '', 'ADDED_CLASSES',
    ));

    // Flag any added class with a suspicious name
    for (const cd of added) {
      const simple = cd.fqn.split('.').pop().toLowerCase();
      for (const pattern of SUSPICIOUS_NAMES) {
        if (simple.includes(pattern)) {
          addDetection(new Detection(
            'SEVERE',
            `Added class '${cd.fqn}' has a suspicious name (not present in official build)`,
            cd.fqn, 'ADDED_SUSPICIOUS_CLASS',
          ));
          break;
        }
      }
    }
  },

  // ── Removed classes ──────────────────────────────────────────────
  function ruleRemovedClasses(diffResult) {
    const removed = [...diffResult.classes.values()].filter(c => c.status === 'removed');
    if (removed.length === 0) return;
    const names = removed.map(c => c.fqn.split('.').pop()).join(', ');
    addDetection(new Detection(
      'CAUTIOUS',
      `Plugin is missing ${removed.length} class${removed.length !== 1 ? 'es' : ''} present in the reference JAR: ${names}`,
      '', 'REMOVED_CLASSES',
    ));
  },

  // ── Added methods in modified classes ────────────────────────────
  function ruleAddedMethods(diffResult) {
    const findings = [];
    for (const cd of diffResult.classes.values()) {
      if (!cd.methods) continue;
      for (const md of cd.methods.values()) {
        if (md.status !== 'added') continue;
        findings.push(`${cd.fqn.split('.').pop()}#${md.name}`);
        // Suspicious method name in a modified/added method
        const nl = md.name.toLowerCase();
        for (const pattern of SUSPICIOUS_NAMES) {
          if (nl.includes(pattern)) {
            addDetection(new Detection(
              'SEVERE',
              `Added method '${md.name}' in class '${cd.fqn}' has a suspicious name`,
              `${cd.fqn}#${md.name}`, 'ADDED_SUSPICIOUS_METHOD',
            ));
            break;
          }
        }
      }
    }
    if (findings.length > 0) {
      addDetection(new Detection(
        findings.length >= 10 ? 'SUSPICIOUS' : 'CAUTIOUS',
        `Plugin adds ${findings.length} method${findings.length !== 1 ? 's' : ''} not present in the official build`,
        '', 'ADDED_METHODS',
      ));
    }
  },

  // ── Added calls in existing methods (code injection vector) ──────
  function ruleAddedCalls(diffResult) {
    const callFindings = [];
    for (const cd of diffResult.classes.values()) {
      if (!cd.methods) continue;
      for (const md of cd.methods.values()) {
        if (md.status === 'added' || md.status === 'removed') continue;
        const addedCalls = (md.calls ?? []).filter(c => c.status === 'added');
        for (const call of addedCalls) {
          callFindings.push(`${cd.fqn.split('.').pop()}#${md.name} → ${call.display}`);
        }
      }
    }
    if (callFindings.length === 0) return;
    addDetection(new Detection(
      callFindings.length >= 5 ? 'SUSPICIOUS' : 'CAUTIOUS',
      `${callFindings.length} call${callFindings.length !== 1 ? 's' : ''} added to existing methods (possible code injection)`,
      callFindings.slice(0, 5).join('; ') + (callFindings.length > 5 ? '…' : ''),
      'ADDED_CALLS',
    ));
  },

  // ── Identical plugins (clean) ─────────────────────────────────────
  function ruleIdentical(diffResult) {
    const { added, removed, modified } = diffResult.summary;
    if (added === 0 && removed === 0 && modified === 0) {
      addDetection(new Detection(
        'INFO',
        'Plugin bytecode matches the reference JAR exactly',
        '', 'IDENTICAL',
      ));
    }
  },

];
