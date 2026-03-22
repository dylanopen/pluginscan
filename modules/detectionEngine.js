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
 *   runDetections(classMap)   → Array<Detection>
 *
 * Severity levels (low → high):
 *   'CAUTIOUS'   — worth noting; probably benign
 *   'SUSPICIOUS' — warrants manual review
 *   'SEVERE'     — strong indicator of malicious intent
 *
 * Adding new rules:
 *   Push a function into the RULES array.
 *   Each rule is:  (classMap: Map<string,ClassInfo>) => void
 *   Rules call addDetection() for every finding they produce.
 */

// ── Detection class ───────────────────────────────────────────────

export class Detection {
  /**
   * @param {'CAUTIOUS'|'SUSPICIOUS'|'SEVERE'} severity
   * @param {string} message   Human-readable description
   * @param {string} [source]  FQN of the class/method that triggered it
   * @param {string} [rule]    Short rule identifier (e.g. 'SUSPICIOUS_CLASS_NAME')
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
export const SEVERITY_ORDER = { SEVERE: 0, SUSPICIOUS: 1, CAUTIOUS: 2 };

// ── Global detections array ───────────────────────────────────────
window.detections = [];

export function clearDetections() {
  window.detections = [];
}

export function addDetection(detection) {
  window.detections.push(detection);
}

// ── Rule runner ───────────────────────────────────────────────────

/**
 * Run all registered rules against the classMap produced by processJar.
 * Populates window.detections and returns it.
 *
 * @param {Map<string, ClassInfo>} classMap
 * @returns {Array<Detection>}
 */
export function runDetections(classMap) {
  clearDetections();
  for (const rule of RULES) {
    try { rule(classMap); }
    catch (err) { console.warn('[detectionEngine] rule threw:', err); }
  }
  // Sort: SEVERE first, then SUSPICIOUS, then CAUTIOUS
  window.detections.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
  return window.detections;
}

// ══════════════════════════════════════════════════════════════════
// RULES
// Each rule is a function: (classMap) => void
// Call addDetection() for every finding.
// ══════════════════════════════════════════════════════════════════

const SUSPICIOUS_NAMES = [
  'compatmodule',
  'servicehelper',
  'inject',
];

const RULES = [

  // ── Rule: SUSPICIOUS_CLASS_NAME ─────────────────────────────────
  // Flag any class whose simple name (case-insensitive) contains
  // known suspicious substrings.
  function ruleSuspiciousClassName(classMap) {
    for (const [fqn, info] of classMap) {
      if (info.parseError) continue;

      const simple = fqn.split('.').pop().toLowerCase();

      for (const pattern of SUSPICIOUS_NAMES) {
        if (simple.includes(pattern)) {
          addDetection(new Detection(
            'SUSPICIOUS',
            `Plugin defines class '${fqn}' with suspicious name`,
            fqn,
            'SUSPICIOUS_CLASS_NAME',
          ));
          break; // one detection per class, even if multiple patterns match
        }
      }
    }
  },

  // ── Rule: SUSPICIOUS_METHOD_NAME ────────────────────────────────
  // Flag any method whose name (case-insensitive) contains the same
  // suspicious substrings.
  function ruleSuspiciousMethodName(classMap) {
    for (const [fqn, info] of classMap) {
      if (info.parseError) continue;

      for (const method of info.methods ?? []) {
        const nameLower = method.name.toLowerCase();
        for (const pattern of SUSPICIOUS_NAMES) {
          if (nameLower.includes(pattern)) {
            addDetection(new Detection(
              'SUSPICIOUS',
              `Class '${fqn}' defines method '${method.name}' with suspicious name`,
              `${fqn}#${method.name}`,
              'SUSPICIOUS_METHOD_NAME',
            ));
            break;
          }
        }
      }
    }
  },

];
