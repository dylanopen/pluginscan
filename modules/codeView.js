/**
 * modules/codeView.js
 * Renders disassembled source into the code panel with syntax colouring.
 *
 * The highlighter works as a single-pass tokeniser over the raw source
 * string.  It never runs regexes over already-tagged HTML, which was
 * the root cause of class-attribute / tag-content corruption.
 *
 * Token priority (first match wins):
 *   1. Block comment   /* … *\/
 *   2. Line comment    // …
 *   3. String literal  " … "
 *   4. Char literal    ' … '
 *   5. Number          0x… | digits
 *   6. Word            letters/digits/$/_  → keyword | type | plain
 *   7. Single char     anything else → HTML-escaped
 */

export function renderCode(className, source) {
  document.getElementById('active-file-name').textContent = className;
  document.getElementById('code-content').innerHTML = highlight(source);
  setupCopyButton(source);
}

// ── Keyword set ───────────────────────────────────────────────────

const KEYWORDS = new Set([
  'abstract','assert','boolean','break','byte','case','catch','char','class',
  'const','continue','default','do','double','else','enum','extends','final',
  'finally','float','for','goto','if','implements','import','instanceof','int',
  'interface','long','native','new','package','private','protected','public',
  'return','short','static','strictfp','super','switch','synchronized','this',
  'throw','throws','transient','try','void','volatile','while','null','true','false',
  // JVM mnemonics that appear in disassembly
  'nop','bipush','sipush','ldc','iload','lload','fload','dload','aload',
  'istore','lstore','fstore','dstore','astore',
  'iadd','ladd','fadd','dadd','isub','lsub','fsub','dsub',
  'imul','lmul','fmul','dmul','idiv','ldiv','fdiv','ddiv',
  'irem','lrem','frem','drem','ineg','lneg','fneg','dneg',
  'ishl','lshl','ishr','lshr','iushr','lushr',
  'iand','land','ior','lor','ixor','lxor','iinc',
  'i2l','i2f','i2d','l2i','l2f','l2d','f2i','f2l','f2d','d2i','d2l','d2f',
  'i2b','i2c','i2s',
  'lcmp','fcmpl','fcmpg','dcmpl','dcmpg',
  'ireturn','lreturn','freturn','dreturn','areturn','return',
  'getstatic','putstatic','getfield','putfield',
  'invokevirtual','invokespecial','invokestatic','invokeinterface','invokedynamic',
  'ifeq','ifne','iflt','ifge','ifgt','ifle',
  'if_icmpeq','if_icmpne','if_icmplt','if_icmpge','if_icmpgt','if_icmple',
  'if_acmpeq','if_acmpne','ifnull','ifnonnull',
  'goto','jsr','ret','tableswitch','lookupswitch','goto_w','jsr_w',
  'athrow','checkcast','instanceof','monitorenter','monitorexit',
  'arraylength','newarray','anewarray','multianewarray',
  'dup','dup_x1','dup_x2','dup2','dup2_x1','dup2_x2','pop','pop2','swap',
  'wide','aconst_null','lconst','fconst','dconst','iconst',
]);

// ── Single-pass tokeniser ─────────────────────────────────────────

function highlight(source) {
  const out = [];
  let   i   = 0;
  const len = source.length;

  while (i < len) {

    // 1. Block comment  /* ... */
    if (source[i] === '/' && source[i+1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const raw = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      out.push(span('cmt', raw));
      i += raw.length;
      continue;
    }

    // 2. Line comment  // ...
    if (source[i] === '/' && source[i+1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = len;
      out.push(span('cmt', source.slice(i, end)));
      i = end;
      continue;
    }

    // 3. String literal  " ... "
    if (source[i] === '"') {
      let j = i + 1;
      while (j < len && source[j] !== '"' && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        j++;
      }
      if (j < len && source[j] === '"') j++;
      out.push(span('str', source.slice(i, j)));
      i = j;
      continue;
    }

    // 4. Char literal  ' ... '
    if (source[i] === "'" && i + 1 < len) {
      let j = i + 1;
      if (source[j] === '\\') j++;
      j++; // the char itself
      if (j < len && source[j] === "'") j++;
      out.push(span('str', source.slice(i, j)));
      i = j;
      continue;
    }

    // 5a. Hex number  0x…
    if (source[i] === '0' && i + 1 < len && (source[i+1] === 'x' || source[i+1] === 'X')) {
      let j = i + 2;
      while (j < len && /[0-9a-fA-F]/.test(source[j])) j++;
      out.push(span('num', source.slice(i, j)));
      i = j;
      continue;
    }

    // 5b. Decimal / float  (guard: not preceded by a word char)
    if (/[0-9]/.test(source[i]) && (i === 0 || !/[\w$]/.test(source[i-1]))) {
      let j = i;
      while (j < len && /[0-9]/.test(source[j])) j++;
      if (j < len && source[j] === '.') {
        j++;
        while (j < len && /[0-9]/.test(source[j])) j++;
      }
      if (j < len && /[fFdDlL]/.test(source[j])) j++;
      out.push(span('num', source.slice(i, j)));
      i = j;
      continue;
    }

    // 6. Word (identifier / keyword / type name)
    if (/[\w$]/.test(source[i])) {
      let j = i;
      while (j < len && /[\w$]/.test(source[j])) j++;
      const word = source.slice(i, j);
      if (KEYWORDS.has(word)) {
        out.push(span('kw', word));
      } else if (/^[A-Z]/.test(word)) {
        out.push(span('type', word));
      } else {
        // plain identifier — still needs HTML escaping (shouldn't contain
        // HTML-special chars, but be safe)
        out.push(esc(word));
      }
      i = j;
      continue;
    }

    // 7. Unicode arrow used in branch operands (→)
    if (source[i] === '\u2192') {
      out.push(span('op', '\u2192'));
      i++;
      continue;
    }

    // 8. Everything else — escape and emit
    out.push(esc(source[i]));
    i++;
  }

  return out.join('');
}

// ── Helpers ───────────────────────────────────────────────────────

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function esc(str) {
  return str.replace(/[&<>"]/g, c => ESC_MAP[c]);
}

function span(cls, raw) {
  // cls is always a hardcoded string — no need to escape it
  return `<span class="${cls}">${esc(raw)}</span>`;
}

// ── Copy button ───────────────────────────────────────────────────

function setupCopyButton(source) {
  const btn = document.getElementById('copy-btn');
  btn.textContent = 'copy';
  btn.classList.remove('copied');

  // Replace node to drop old event listeners cleanly
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);

  fresh.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source);
      fresh.textContent = 'copied ✓';
      fresh.classList.add('copied');
      setTimeout(() => { fresh.textContent = 'copy'; fresh.classList.remove('copied'); }, 1800);
    } catch {
      fresh.textContent = 'failed';
    }
  });
}
