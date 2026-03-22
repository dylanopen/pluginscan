/**
 * modules/diffEngine.js
 * ─────────────────────────────────────────────────────────────────
 * Compares two classMaps (uploaded vs official) and produces a
 * structured diff that the diff view can render.
 *
 * Terminology:
 *   "uploaded"  = the JAR the user dropped in (potentially malicious)
 *   "official"  = the reference JAR uploaded by the user
 *
 * Status values:
 *   'added'    — present in uploaded, absent from official
 *   'removed'  — present in official, absent from uploaded
 *   'modified' — present in both but something changed
 *   'unchanged'— identical in both (never appears in output)
 *
 * Exported API:
 *   diffClassMaps(uploaded, official) → DiffResult
 *
 * Types:
 *   DiffResult {
 *     classes: Map<string, ClassDiff>   // key = FQN
 *     summary: { added, removed, modified, unchanged }
 *   }
 *   ClassDiff {
 *     fqn, status,
 *     uploadedInfo, officialInfo,          // raw ClassInfo (may be null)
 *     methods: Map<string, MethodDiff>     // key = method.key
 *   }
 *   MethodDiff {
 *     key, name, descriptor, status,
 *     uploadedMethod, officialMethod,
 *     calls: CallDiff[]
 *   }
 *   CallDiff { display, mnemonic, owner, methodName, descriptor, status }
 */

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * @param {Map<string,ClassInfo>} uploaded
 * @param {Map<string,ClassInfo>} official
 * @returns {DiffResult}
 */
export function diffClassMaps(uploaded, official) {
  const classes = new Map();
  const allKeys = new Set([...uploaded.keys(), ...official.keys()]);

  let added = 0, removed = 0, modified = 0, unchanged = 0;

  for (const fqn of allKeys) {
    const u = uploaded.get(fqn) ?? null;
    const o = official.get(fqn) ?? null;

    let status;
    if      (!o && u)  status = 'added';
    else if  (o && !u) status = 'removed';
    else {
      // Both present — diff methods
      const methodDiff = diffMethods(u, o);
      const hasChange  = [...methodDiff.values()].some(m => m.status !== 'unchanged');
      status = hasChange ? 'modified' : 'unchanged';

      if (status === 'unchanged') { unchanged++; continue; } // skip unchanged

      classes.set(fqn, { fqn, status, uploadedInfo: u, officialInfo: o, methods: methodDiff });
      modified++;
      continue;
    }

    if (status === 'added')   added++;
    if (status === 'removed') removed++;

    const methods = diffMethods(u, o);
    classes.set(fqn, { fqn, status, uploadedInfo: u, officialInfo: o, methods });
  }

  return { classes, summary: { added, removed, modified, unchanged } };
}

// ─────────────────────────────────────────────────────────────────
// Method diff
// ─────────────────────────────────────────────────────────────────

function diffMethods(uploadedInfo, officialInfo) {
  const result = new Map();

  const uMethods = indexBy(uploadedInfo?.methods ?? [], m => m.key);
  const oMethods = indexBy(officialInfo?.methods  ?? [], m => m.key);
  const allKeys  = new Set([...uMethods.keys(), ...oMethods.keys()]);

  for (const key of allKeys) {
    const u = uMethods.get(key) ?? null;
    const o = oMethods.get(key) ?? null;

    let status;
    if      (!o && u) status = 'added';
    else if  (o && !u) status = 'removed';
    else {
      const callDiff = diffCalls(u.calls, o.calls);
      const hasChange = callDiff.some(c => c.status !== 'unchanged');
      status = hasChange ? 'modified' : 'unchanged';
    }

    const calls = diffCalls(u?.calls ?? [], o?.calls ?? []);
    result.set(key, {
      key,
      name:           u?.name ?? o?.name,
      descriptor:     u?.descriptor ?? o?.descriptor,
      returnType:     u?.returnType ?? o?.returnType,
      paramTypes:     u?.paramTypes ?? o?.paramTypes ?? [],
      accessFlags:    u?.accessFlags ?? o?.accessFlags ?? 0,
      isConstructor:  u?.isConstructor ?? o?.isConstructor ?? false,
      isStaticInit:   u?.isStaticInit  ?? o?.isStaticInit  ?? false,
      status,
      uploadedMethod: u,
      officialMethod: o,
      calls,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Call diff
// ─────────────────────────────────────────────────────────────────

function diffCalls(uploadedCalls, officialCalls) {
  // Key calls by "owner.methodName descriptor" for deduplication
  const callKey = c => `${c.owner}.${c.methodName} ${c.descriptor}`;

  const uMap = indexBy(uploadedCalls, callKey);
  const oMap = indexBy(officialCalls, callKey);
  const all  = new Set([...uMap.keys(), ...oMap.keys()]);
  const out  = [];

  for (const k of all) {
    const u = uMap.get(k);
    const o = oMap.get(k);
    const base = u ?? o;
    const status = !o ? 'added' : !u ? 'removed' : 'unchanged';
    out.push({ ...base, status });
  }

  // Sort: added first, then removed, then unchanged — keeps the list readable
  out.sort((a, b) => {
    const order = { added: 0, removed: 1, modified: 2, unchanged: 3 };
    return order[a.status] - order[b.status];
  });

  return out;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function indexBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) m.set(keyFn(item), item);
  return m;
}
