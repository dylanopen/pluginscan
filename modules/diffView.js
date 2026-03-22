/**
 * modules/diffView.js
 * ─────────────────────────────────────────────────────────────────
 * Renders the diff between uploaded and official plugin into the
 * existing 3-column layout.
 *
 * Column 1 (tree-list):    changed classes, colour-coded by status
 * Column 2 (method-list):  methods of selected class, colour-coded
 * Column 3 (call-panel):   calls of selected method, colour-coded
 *
 * Status colours:
 *   added    → green  (diff-added)
 *   removed  → red    (diff-removed)
 *   modified → yellow (diff-modified)
 *   unchanged→ dim    (diff-unchanged, only shown inside modified classes)
 *
 * Public API:
 *   renderDiffTree(diffResult, onMethodPanelOpen)
 *   clearDiffTree()
 */

export function renderDiffTree(diffResult, { onMethodPanelOpen } = {}) {
  const treeList   = document.getElementById('tree-list');
  const countLabel = document.getElementById('file-count-label');
  const searchInput = document.getElementById('search-input');

  const { classes, summary } = diffResult;
  const total = classes.size;

  countLabel.textContent = `${total} changed class${total !== 1 ? 'es' : ''}`;

  treeList.innerHTML = '';

  if (total === 0) {
    treeList.innerHTML = '<li class="tree-item tree-empty">No differences found — plugins appear identical.</li>';
    clearMemberPanel();
    return;
  }

  // Sort: added, removed, modified
  const sorted = [...classes.values()].sort((a, b) => {
    const order = { added: 0, removed: 1, modified: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.fqn.localeCompare(b.fqn);
  });

  const items = sorted.map(cd => buildClassItem(cd, onSelect));
  items.forEach(el => treeList.appendChild(el));

  // Reset search listener
  const newSearch = searchInput.cloneNode(true);
  newSearch.value = '';
  searchInput.parentNode.replaceChild(newSearch, searchInput);
  newSearch.addEventListener('input', () => {
    const q = newSearch.value.toLowerCase();
    items.forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  });

  // Auto-select first item
  if (items.length > 0) items[0].click();

  function onSelect(classDiff) {
    items.forEach(el => el.classList.remove('active'));
    items.find(el => el.dataset.fqn === classDiff.fqn)?.classList.add('active');
    renderDiffMemberPanel(classDiff, { onMethodPanelOpen });
  }
}

export function clearDiffTree() {
  clearMemberPanel();
  const treeList = document.getElementById('tree-list');
  if (treeList) treeList.innerHTML = '';
}

// ── Class tree item ───────────────────────────────────────────────

function buildClassItem(cd, onSelect) {
  const li = document.createElement('li');
  li.className    = `tree-item diff-item diff-${cd.status}`;
  li.dataset.name = cd.fqn.toLowerCase();
  li.dataset.fqn  = cd.fqn;

  const icon = { added: '+', removed: '−', modified: '~' }[cd.status] ?? ' ';
  const simple = cd.fqn.split('.').pop();

  li.innerHTML = `<span class="diff-icon diff-icon-${cd.status}">${icon}</span> ${esc(simple)}`;
  li.title = cd.fqn;

  li.addEventListener('click', () => onSelect(cd));
  return li;
}

// ── Member panel (methods) ────────────────────────────────────────

function renderDiffMemberPanel(cd, { onMethodPanelOpen } = {}) {
  const methodList  = document.getElementById('method-list');
  const classLabel  = document.getElementById('class-label');
  const methodCount = document.getElementById('method-count-label');
  const fieldList   = document.getElementById('field-list');
  const fieldCount  = document.getElementById('field-count-label');
  const callPanel   = document.getElementById('call-panel');

  if (classLabel) {
    classLabel.textContent = cd.fqn;
    classLabel.title       = cd.fqn;
  }

  // Fields: show diff of fields if class is added/removed/modified
  if (fieldList) renderDiffFields(cd, fieldList, fieldCount);

  // Methods
  const allMethods = [...(cd.methods?.values() ?? [])];
  // Only show non-unchanged methods (for added/removed classes, all are added/removed)
  const visible = allMethods.filter(m => m.status !== 'unchanged');

  methodCount.textContent = `${visible.length} changed method${visible.length !== 1 ? 's' : ''}`;
  methodList.innerHTML = '';
  callPanel.innerHTML  = '<div class="call-panel-empty">← select a method</div>';

  if (visible.length === 0) {
    methodList.innerHTML = '<li class="tree-item tree-empty">no method changes</li>';
    return;
  }

  const sorted = visible.sort((a, b) => {
    const order = { added: 0, removed: 1, modified: 2, unchanged: 3 };
    return order[a.status] - order[b.status];
  });

  const items = sorted.map(md => buildMethodItem(md, onSelectMethod));
  items.forEach(el => methodList.appendChild(el));
  if (items.length > 0) items[0].click();

  function onSelectMethod(md) {
    items.forEach(el => el.classList.remove('active'));
    items.find(el => el.dataset.key === md.key)?.classList.add('active');
    renderDiffCallPanel(md, callPanel);
    onMethodPanelOpen?.(md.name);
  }
}

// ── Fields diff ───────────────────────────────────────────────────

function renderDiffFields(cd, container, countEl) {
  container.innerHTML = '';

  const uFields = cd.uploadedInfo?.fields ?? [];
  const oFields = cd.officialInfo?.fields  ?? [];

  const fieldKey = f => `${f.name}:${f.descriptor}`;
  const uMap = new Map(uFields.map(f => [fieldKey(f), f]));
  const oMap = new Map(oFields.map(f => [fieldKey(f), f]));
  const all  = new Set([...uMap.keys(), ...oMap.keys()]);

  const diffs = [];
  for (const k of all) {
    const u = uMap.get(k), o = oMap.get(k);
    const status = !o ? 'added' : !u ? 'removed' : 'unchanged';
    if (status === 'unchanged') continue;
    diffs.push({ ...(u ?? o), status });
  }

  if (countEl) countEl.textContent = diffs.length ? `${diffs.length} changed` : '';

  if (diffs.length === 0) {
    container.innerHTML = '<li class="field-item field-empty">no field changes</li>';
    return;
  }

  for (const f of diffs) {
    const li = document.createElement('li');
    li.className = `field-item diff-field-${f.status}`;
    const icon = f.status === 'added' ? '+' : '−';
    li.innerHTML = `
      <span class="diff-icon diff-icon-${f.status}">${icon}</span>
      <span class="field-body">
        <span class="field-type">${esc(f.javaType ?? f.descriptor)}</span>
        <span class="field-name">${esc(f.name)}</span>
      </span>`;
    container.appendChild(li);
  }
}

// ── Method list item ──────────────────────────────────────────────

function buildMethodItem(md, onSelect) {
  const li = document.createElement('li');
  li.className   = `tree-item method-item diff-item diff-${md.status}`;
  li.dataset.key = md.key;

  const icon   = md.isStaticInit ? '⟳' : md.isConstructor ? '⬡' : (md.accessFlags & 0x0008) ? '◈' : '◇';
  const sIcon  = { added: '+', removed: '−', modified: '~' }[md.status] ?? '';
  const params = (md.paramTypes ?? []).join(', ');

  li.innerHTML = `
    <span class="diff-icon diff-icon-${md.status}">${sIcon}</span>
    <span class="method-icon">${icon}</span>
    <span class="method-sig">
      <span class="method-name">${esc(md.name)}</span><span class="method-params">(${esc(params)})</span>
    </span>`;

  li.addEventListener('click', () => onSelect(md));
  return li;
}

// ── Call panel diff ───────────────────────────────────────────────

function renderDiffCallPanel(md, container) {
  const paramStr = (md.paramTypes ?? []).map((t, i) => `${t} arg${i}`).join(', ');
  const sig = md.isStaticInit
    ? 'static { }'
    : md.isConstructor
      ? `${md.name}(${paramStr})`
      : `${md.returnType} ${md.name}(${paramStr})`;

  const changedCalls = (md.calls ?? []).filter(c => c.status !== 'unchanged');
  const allCalls     = md.calls ?? [];

  let html = `
    <div class="call-panel-header">
      <span class="call-panel-sig diff-sig-${md.status}">${esc(sig)}</span>
      <span class="call-panel-count">${changedCalls.length} changed / ${allCalls.length} total</span>
    </div>`;

  if (allCalls.length === 0) {
    html += '<div class="call-panel-empty">— no calls —</div>';
    container.innerHTML = html;
    return;
  }

  // Show all calls; dim unchanged ones, highlight added/removed
  html += '<ul class="call-group-list">';

  for (const call of allCalls) {
    const ownerSimple = (call.owner ?? '').split('.').pop() || call.owner;
    const callIcon = { added: '+', removed: '−', unchanged: ' ' }[call.status] ?? ' ';
    const paramHtml = (call.paramTypes ?? [])
      .map(t => `<span class="call-param">${esc(t)}</span>`)
      .join('<span class="call-comma">, </span>');
    const retStr = call.returnType && call.returnType !== '?'
      ? ` <span class="call-arrow">→</span> <span class="call-return">${esc(call.returnType)}</span>` : '';

    html += `
      <li class="call-site diff-call-${call.status}">
        <span class="diff-icon diff-icon-${call.status}">${callIcon}</span>
        <span class="call-mnemonic ${mnemonicClass(call.mnemonic)}">${abbrevMnemonic(call.mnemonic)}</span>
        <span class="call-detail">
          <span class="call-group-fqn">${esc(ownerSimple)}</span><span class="call-parens">.</span><span class="call-method-name">${esc(call.methodName === '<init>' ? 'new ' + ownerSimple : call.methodName)}</span><span class="call-parens">(${paramHtml})</span>${retStr}
        </span>
      </li>`;
  }

  html += '</ul>';
  container.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────

function clearMemberPanel() {
  const els = ['method-list', 'call-panel', 'field-list'];
  for (const id of els) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }
  const mc = document.getElementById('method-count-label');
  if (mc) mc.textContent = '0 methods';
  const cl = document.getElementById('class-label');
  if (cl) { cl.textContent = '—'; cl.title = ''; }
}

function mnemonicClass(m) {
  return { invokevirtual:'mn-virtual', invokespecial:'mn-special',
           invokestatic:'mn-static', invokeinterface:'mn-interface',
           invokedynamic:'mn-dynamic' }[m] ?? 'mn-virtual';
}

function abbrevMnemonic(m) {
  return { invokevirtual:'virt', invokespecial:'spec',
           invokestatic:'stat', invokeinterface:'ifc',
           invokedynamic:'dyn' }[m] ?? m;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
