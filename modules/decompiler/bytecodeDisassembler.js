/**
 * modules/decompiler/bytecodeDisassembler.js
 * ─────────────────────────────────────────────────────────────────
 * Pure-JavaScript Java .class file parser.
 *
 * Implements the Java Class File Format (JVMS §4).
 * Only the information needed to build a call graph is extracted:
 *   - Method signatures (name, descriptor, access flags)
 *   - invoke* opcodes inside each method's Code attribute
 *
 * Everything else (fields, non-invoke opcodes, attributes beyond
 * Code) is consumed from the byte stream and discarded so the
 * offset arithmetic stays correct, but nothing is stored.
 *
 * Exported API:
 *   parseClass(bytes: Uint8Array): ClassInfo
 *
 * Types:
 *   ClassInfo  { className, superName, interfaceNames, accessFlags,
 *                fields: FieldInfo[], methods: MethodInfo[] }
 *   FieldInfo  { name, descriptor, javaType, accessFlags, isStatic, isFinal }
 *   MethodInfo { key, name, descriptor, returnType, paramTypes,
 *                accessFlags, isConstructor, isStaticInit, calls: CallSite[] }
 *   CallSite   { mnemonic, owner, methodName, descriptor,
 *                returnType, paramTypes, display }
 */

// ── Invoke opcodes — the only ones whose operands we keep ─────────
const INVOKE_OPCODES = new Set([0xb6, 0xb7, 0xb8, 0xb9, 0xba]);
const INVOKE_MNEMONIC = {
  0xb6: 'invokevirtual',
  0xb7: 'invokespecial',
  0xb8: 'invokestatic',
  0xb9: 'invokeinterface',
  0xba: 'invokedynamic',
};

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * @param {Uint8Array} bytes
 * @returns {ClassInfo}
 */
export function parseClass(bytes) {
  const view   = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let   offset = 0;

  const u1 = () => { const v = view.getUint8(offset);              offset += 1; return v; };
  const u2 = () => { const v = view.getUint16(offset, false);       offset += 2; return v; };
  const u4 = () => { const v = view.getUint32(offset, false);       offset += 4; return v; };
  const skip = n => { offset += n; };

  // ── Magic + version ───────────────────────────────────────────
  const magic = u4();
  if (magic !== 0xCAFEBABE) throw new Error('Not a valid .class file (bad magic)');
  skip(4); // minor + major version

  // ── Constant Pool ─────────────────────────────────────────────
  const cpCount = u2();
  const cp      = [null]; // 1-indexed
  let   i       = 1;
  while (i < cpCount) {
    const tag = u1();
    switch (tag) {
      case 1: { // Utf8
        const len = u2();
        const chars = [];
        for (let j = 0; j < len; j++) chars.push(u1());
        cp.push({ tag, value: decodeUtf8(chars) });
        break;
      }
      case 3: case 4:  cp.push({ tag }); skip(4); break; // Integer, Float
      case 5: case 6:  cp.push({ tag }); cp.push(null); skip(8); i++; break; // Long, Double (2 slots)
      case 7:  cp.push({ tag, nameIndex:  u2() }); break; // Class
      case 8:  cp.push({ tag, stringIndex: u2() }); break; // String
      case 9:  case 10: case 11: // Fieldref, Methodref, InterfaceMethodref
        cp.push({ tag, classIndex: u2(), natIndex: u2() }); break;
      case 12: cp.push({ tag, nameIndex: u2(), descIndex: u2() }); break; // NameAndType
      case 15: cp.push({ tag }); skip(3); break; // MethodHandle
      case 16: cp.push({ tag }); skip(2); break; // MethodType
      case 17: case 18: cp.push({ tag }); skip(4); break; // Dynamic, InvokeDynamic
      case 19: case 20: cp.push({ tag }); skip(2); break; // Module, Package
      default: throw new Error(`Unknown CP tag ${tag} at index ${i}`);
    }
    i++;
  }

  // ── Class metadata ────────────────────────────────────────────
  const classAccessFlags = u2();
  const thisClassIndex   = u2();
  const superIndex       = u2();
  const ifaceCount       = u2();
  const ifaceIndices     = [];
  for (let k = 0; k < ifaceCount; k++) ifaceIndices.push(u2());

  const thisName   = cpClassName(cp, thisClassIndex);
  const superName  = superIndex ? cpClassName(cp, superIndex) : null;
  const simpleName = thisName.split('.').pop();
  const ifaceNames = ifaceIndices.map(idx => cpClassName(cp, idx));

  // ── Fields — parse name, type and flags ──────────────────────
  const fieldCount = u2();
  const fields = [];
  for (let k = 0; k < fieldCount; k++) fields.push(parseField());

  // ── Methods — parse for calls ─────────────────────────────────
  const methodCount = u2();
  const methods = [];
  for (let k = 0; k < methodCount; k++) {
    methods.push(parseMethod(simpleName));
  }

  // ── Class attributes — skip ───────────────────────────────────
  const classAttrCount = u2();
  for (let k = 0; k < classAttrCount; k++) { u2(); skip(u4()); }

  return { className: thisName, superName, interfaceNames: ifaceNames,
           accessFlags: classAccessFlags, fields, methods };

  // ── Inner: parse a field ──────────────────────────────────────
  function parseField() {
    const flags   = u2();
    const nameIdx = u2();
    const descIdx = u2();
    const attrCount = u2();
    // Skip all field attributes (ConstantValue etc.)
    for (let a = 0; a < attrCount; a++) { u2(); skip(u4()); }
    const name       = cpUtf8(cp, nameIdx);
    const descriptor = cpUtf8(cp, descIdx);
    return {
      name,
      descriptor,
      javaType:    descriptorToType(descriptor),
      accessFlags: flags,
      isStatic:    (flags & 0x0008) !== 0,
      isFinal:     (flags & 0x0010) !== 0,
    };
  }

  // ── Inner: parse a method, extracting call sites ──────────────
  function parseMethod(className) {
    const flags   = u2();
    const nameIdx = u2();
    const descIdx = u2();
    const attrCount = u2();

    const rawName    = cpUtf8(cp, nameIdx);
    const descriptor = cpUtf8(cp, descIdx);
    const { params, ret } = parseMethodDescriptor(descriptor);
    const displayName = rawName === '<init>' ? className : rawName;

    const method = {
      key:           `${rawName}:${descriptor}`,
      name:          displayName,
      descriptor,
      returnType:    ret,
      paramTypes:    params,
      accessFlags:   flags,
      isConstructor: rawName === '<init>',
      isStaticInit:  rawName === '<clinit>',
      calls:         [],
    };

    for (let a = 0; a < attrCount; a++) {
      const attrNameIdx = u2();
      const len         = u4();
      if (cpUtf8(cp, attrNameIdx) === 'Code') {
        const codeEnd = offset + len;
        method.calls = parseCodeForCalls(len, codeEnd);
        // offset is now at codeEnd — don't skip again
      } else {
        skip(len);
      }
    }

    return method;
  }

  // ── Inner: scan a Code attribute, collect only invoke* sites ──
  function parseCodeForCalls(attrLen, codeEnd) {
    // Code attribute layout: max_stack(2) max_locals(2) code_length(4) code(...)
    const maxStack  = u2(); // eslint-disable-line no-unused-vars
    const maxLocals = u2(); // eslint-disable-line no-unused-vars
    const codeLen   = u4();
    const codeStart = offset;
    const codeStop  = codeStart + codeLen;

    const calls = [];

    while (offset < codeStop) {
      const pc     = offset;
      const opcode = u1();

      if (INVOKE_OPCODES.has(opcode)) {
        // All invoke* take a u2 CP index
        const cpIdx    = u2();
        const mnemonic = INVOKE_MNEMONIC[opcode];

        if (opcode === 0xb9 || opcode === 0xba) {
          // invokeinterface and invokedynamic have 2 extra padding bytes
          skip(2);
        }

        const call = resolveInvoke(cp, cpIdx, mnemonic);
        if (call) calls.push(call);
        continue;
      }

      // For every other opcode, just consume the right number of bytes
      skipOpcodeOperands(opcode, pc, codeStart);
    }

    // Skip the rest of the Code attribute (exception table + code attributes)
    offset = codeEnd;
    return calls;
  }

  // ── Inner: consume operand bytes for non-invoke opcodes ───────
  function skipOpcodeOperands(opcode, pc, codeStart) {
    // 1-byte operand
    if (
      opcode === 0x10 ||                          // bipush
      (opcode >= 0x15 && opcode <= 0x19) ||       // iload..aload
      (opcode >= 0x36 && opcode <= 0x3a) ||       // istore..astore
      opcode === 0xa9 ||                          // ret
      opcode === 0xbc                             // newarray
    ) { skip(1); return; }

    // 2-byte operand
    if (
      opcode === 0x11 ||                          // sipush
      opcode === 0x13 || opcode === 0x14 ||       // ldc_w, ldc2_w
      opcode === 0xbb || opcode === 0xbd ||       // new, anewarray
      opcode === 0xc0 || opcode === 0xc1 ||       // checkcast, instanceof
      opcode === 0xb2 || opcode === 0xb3 ||       // getstatic, putstatic
      opcode === 0xb4 || opcode === 0xb5          // getfield, putfield
    ) { skip(2); return; }

    // iinc: 2 bytes (index + const)
    if (opcode === 0x84) { skip(2); return; }

    // ldc: 1 byte
    if (opcode === 0x12) { skip(1); return; }

    // branch instructions: 2-byte signed offset
    if (
      (opcode >= 0x99 && opcode <= 0xa8) ||       // ifeq..jsr
      opcode === 0xc6 || opcode === 0xc7           // ifnull, ifnonnull
    ) { skip(2); return; }

    // goto_w, jsr_w: 4-byte offset
    if (opcode === 0xc8 || opcode === 0xc9) { skip(4); return; }

    // multianewarray: 2 + 1
    if (opcode === 0xc5) { skip(3); return; }

    // wide: prefixes another opcode, giving it a u2 index
    if (opcode === 0xc4) {
      const wop = u1();
      skip(2); // wide index
      if (wop === 0x84) skip(2); // wide iinc also has a s2 const
      return;
    }

    // tableswitch: variable length with 4-byte alignment padding
    if (opcode === 0xaa) {
      while ((offset - codeStart) % 4 !== 0) skip(1);
      skip(4); // default
      const low  = view.getInt32(offset, false); skip(4);
      const high = view.getInt32(offset, false); skip(4);
      skip((high - low + 1) * 4);
      return;
    }

    // lookupswitch: variable length with 4-byte alignment padding
    if (opcode === 0xab) {
      while ((offset - codeStart) % 4 !== 0) skip(1);
      skip(4); // default
      const npairs = view.getInt32(offset, false); skip(4);
      skip(npairs * 8);
      return;
    }

    // 0-operand opcodes: nothing to skip
  }
}

// ─────────────────────────────────────────────────────────────────
// Resolve an invoke CP entry into a structured CallSite
// ─────────────────────────────────────────────────────────────────

function resolveInvoke(cp, cpIdx, mnemonic) {
  const entry = cp[cpIdx];
  if (!entry) return null;

  // invokedynamic references a Dynamic/InvokeDynamic entry — just label it
  if (mnemonic === 'invokedynamic') {
    return { mnemonic, owner: 'dynamic', methodName: '(lambda)', descriptor: '',
             returnType: '?', paramTypes: [], display: '(lambda / invokedynamic)' };
  }

  if (![9, 10, 11].includes(entry.tag)) return null;

  const owner      = cpClassName(cp, entry.classIndex);
  const nat        = cp[entry.natIndex];
  if (!nat) return null;

  const methodName = cpUtf8(cp, nat.nameIndex);
  const descriptor = cpUtf8(cp, nat.descIndex);
  const { params, ret } = parseMethodDescriptor(descriptor);

  const ownerSimple = owner.split('.').pop() || owner;
  const display     = methodName === '<init>'
    ? `new ${ownerSimple}(${params.join(', ')})`
    : `${ownerSimple}.${methodName}(${params.join(', ')})`;

  return { mnemonic, owner, methodName, descriptor, returnType: ret, paramTypes: params, display };
}

// ─────────────────────────────────────────────────────────────────
// Constant-pool helpers
// ─────────────────────────────────────────────────────────────────

function cpUtf8(cp, idx) {
  const e = cp[idx];
  return (e && e.tag === 1) ? e.value : `<cp#${idx}>`;
}

function cpClassName(cp, idx) {
  const e = cp[idx];
  if (!e || e.tag !== 7) return `<cp#${idx}>`;
  return cpUtf8(cp, e.nameIndex).replaceAll('/', '.');
}

// ─────────────────────────────────────────────────────────────────
// Descriptor helpers
// ─────────────────────────────────────────────────────────────────

const PRIMITIVES = { B:'byte', C:'char', D:'double', F:'float',
                     I:'int',  J:'long', S:'short',  V:'void', Z:'boolean' };

function descriptorToType(desc) {
  let arrays = 0;
  let d = desc;
  while (d.startsWith('[')) { arrays++; d = d.slice(1); }
  let base;
  if (d.startsWith('L') && d.endsWith(';')) {
    base = d.slice(1, -1).replaceAll('/', '.').split('.').pop();
  } else {
    base = PRIMITIVES[d] ?? d;
  }
  return base + '[]'.repeat(arrays);
}

function parseMethodDescriptor(desc) {
  const match = desc.match(/\(([^)]*)\)(.*)/);
  if (!match) return { params: [], ret: descriptorToType(desc) };

  const paramStr = match[1];
  const params   = [];
  let i = 0;

  while (i < paramStr.length) {
    let token = '';
    while (paramStr[i] === '[') token += paramStr[i++];
    if (paramStr[i] === 'L') {
      const end = paramStr.indexOf(';', i);
      token += paramStr.slice(i, end + 1);
      i = end + 1;
    } else {
      token += paramStr[i++];
    }
    params.push(descriptorToType(token));
  }

  return { params, ret: descriptorToType(match[2]) };
}

// ─────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────

function decodeUtf8(bytes) {
  try   { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
  catch { return bytes.map(b => String.fromCharCode(b)).join(''); }
}
