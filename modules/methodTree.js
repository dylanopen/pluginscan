/**
 * modules/methodTree.js
 * Renders the method list, fields panel, and call-site detail panel.
 *
 * Also manages the mobile "active panel" state via data-panel attributes
 * on the results-layout element.
 *
 * Public API:
 *   renderMethodTree(classInfo, { onMethodPanelOpen })
 *     Populates the method/field column for the given class.
 *     onMethodPanelOpen() is called when a method is selected on mobile
 *     (so app.js can switch the visible panel to call-sites).
 */

export function renderMethodTree(classInfo, { onMethodPanelOpen } = {}) {
  const list        = document.getElementById('method-list');
  const fieldList   = document.getElementById('field-list');
  const callPanel   = document.getElementById('call-panel');
  const methodCount = document.getElementById('method-count-label');
  const fieldCount  = document.getElementById('field-count-label');
  const classLabel  = document.getElementById('class-label');

  if (classLabel) {
    classLabel.textContent = classInfo.className;
    classLabel.title       = classInfo.className;
  }

  // ── Parse error ───────────────────────────────────────────────
  if (classInfo.parseError) {
    methodCount.textContent = 'parse error';
    if (fieldCount) fieldCount.textContent = '';
    list.innerHTML    = `<li class="tree-item tree-empty">failed to parse</li>`;
    if (fieldList) fieldList.innerHTML = '';
    callPanel.innerHTML = `<div class="call-panel-empty error-text">⚠ ${esc(classInfo.parseError)}</div>`;
    return;
  }

  // ── Fields ────────────────────────────────────────────────────
  const fields = classInfo.fields ?? [];
  if (fieldList) renderFieldList(fields, fieldList, fieldCount);

  // ── Methods ───────────────────────────────────────────────────
  const methods = classInfo.methods ?? [];
  methodCount.textContent = `${methods.length} method${methods.length !== 1 ? 's' : ''}`;

  list.innerHTML = '';
  callPanel.innerHTML = '<div class="call-panel-empty">← select a method</div>';

  if (methods.length === 0) {
    list.innerHTML = '<li class="tree-item tree-empty">no methods</li>';
    return;
  }

  const items = methods.map(m => buildMethodItem(m, onSelect));
  items.forEach(el => list.appendChild(el));
  if (items.length > 0) items[0].click();

  function onSelect(method) {
    items.forEach(el => el.classList.remove('active'));
    items.find(el => el.dataset.key === method.key)?.classList.add('active');
    renderCallPanel(method, callPanel);
    // On mobile: tell app.js to switch to the call-panel column
    onMethodPanelOpen?.(method.name);
  }
}

// ── Fields section ────────────────────────────────────────────────

function renderFieldList(fields, container, countEl) {
  container.innerHTML = '';

  // Only show static fields, constants (static final), and instance fields —
  // everything. Group: constants first, then statics, then instance.
  const constants = fields.filter(f => f.isStatic && f.isFinal);
  const statics   = fields.filter(f => f.isStatic && !f.isFinal);
  const instance  = fields.filter(f => !f.isStatic);

  if (countEl) countEl.textContent = `${fields.length} field${fields.length !== 1 ? 's' : ''}`;

  if (fields.length === 0) {
    container.innerHTML = '<li class="field-item field-empty">no fields</li>';
    return;
  }

  const groups = [
    { label: 'CONSTANTS',       items: constants },
    { label: 'STATIC FIELDS',   items: statics   },
    { label: 'INSTANCE FIELDS', items: instance  },
  ];

  for (const { label, items } of groups) {
    if (items.length === 0) continue;

    const header = document.createElement('li');
    header.className   = 'field-group-header';
    header.textContent = label;
    container.appendChild(header);

    for (const f of items) {
      const li = document.createElement('li');
      li.className = 'field-item';

      const badge = accessBadge(f.accessFlags);
      const modifiers = [];
      if (f.isStatic) modifiers.push('static');
      if (f.isFinal)  modifiers.push('final');
      const modStr = modifiers.length ? `<span class="field-mod">${modifiers.join(' ')}</span> ` : '';

      li.innerHTML = `
        <span class="field-badge ${badge.cls}">${badge.label}</span>
        <span class="field-body">
          ${modStr}<span class="field-type">${esc(f.javaType)}</span> <span class="field-name">${esc(f.name)}</span>
        </span>`;

      container.appendChild(li);
    }
  }
}

// ── Method list item ──────────────────────────────────────────────

function buildMethodItem(method, onSelect) {
  const li = document.createElement('li');
  li.className   = 'tree-item method-item';
  li.dataset.key = method.key;

  const icon  = method.isStaticInit ? '⟳' : method.isConstructor ? '⬡' : isStatic(method.accessFlags) ? '◈' : '◇';
  const badge = accessBadge(method.accessFlags);
  const paramStr = method.paramTypes.join(', ');

  li.innerHTML = `
    <span class="method-icon">${icon}</span>
    <span class="method-sig">
      <span class="method-badge ${badge.cls}">${badge.label}</span><span class="method-name">${esc(method.name)}</span><span class="method-params">(${esc(paramStr)})</span>
    </span>
    <span class="call-count ${method.calls.length === 0 ? 'call-count-zero' : ''}">${method.calls.length}</span>`;

  li.addEventListener('click', () => onSelect(method));
  return li;
}

// ── Call detail panel ─────────────────────────────────────────────

function renderCallPanel(method, container) {
  const paramStr = method.paramTypes.map((t, i) => `${t} arg${i}`).join(', ');
  const sig = method.isStaticInit
    ? 'static { }'
    : method.isConstructor
      ? `${method.name}(${paramStr})`
      : `${method.returnType} ${method.name}(${paramStr})`;

  if (method.calls.length === 0) {
    container.innerHTML = `
      <div class="call-panel-header">
        <span class="call-panel-sig">${esc(sig)}</span>
      </div>
      <div class="call-panel-empty">— no method calls —</div>`;
    return;
  }

  const grouped = new Map();
  for (const c of method.calls) {
    if (!grouped.has(c.owner)) grouped.set(c.owner, []);
    grouped.get(c.owner).push(c);
  }

  let html = `
    <div class="call-panel-header">
      <span class="call-panel-sig">${esc(sig)}</span>
      <span class="call-panel-count">${method.calls.length} call${method.calls.length !== 1 ? 's' : ''}</span>
    </div>
    <ul class="call-group-list">`;

  for (const [owner, sites] of grouped) {
    const ownerSimple = owner.split('.').pop() || owner;
    html += `
      <li class="call-group">
        <div class="call-group-owner">
          <span class="call-group-icon">▸</span>
          <span class="call-group-name" title="${esc(owner)}">${esc(ownerSimple)}</span>
          <span class="call-group-fqn">${esc(owner)}</span>
        </div>
        <ul class="call-site-list">`;

    for (const site of sites) {
      const retStr    = site.returnType && site.returnType !== '?'
        ? `<span class="call-arrow"> → </span><span class="call-return">${esc(site.returnType)}</span>` : '';
      const paramHtml = site.paramTypes?.length
        ? site.paramTypes.map(t => `<span class="call-param">${esc(t)}</span>`).join('<span class="call-comma">, </span>')
        : '';
      html += `
        <li class="call-site" title="${esc(owner)}.${esc(site.methodName)} ${esc(site.descriptor)}">
          <span class="call-mnemonic ${mnemonicClass(site.mnemonic)}">${abbrevMnemonic(site.mnemonic)}</span>
          <span class="call-detail">
            <span class="call-method-name">${esc(site.methodName === '<init>' ? 'new ' + ownerSimple : site.methodName)}</span><span class="call-parens">(${paramHtml})</span>${retStr}
          </span>
        </li>`;
    }

    html += `</ul></li>`;
  }

  html += `</ul>`;
  container.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────

function isStatic(flags)    { return (flags & 0x0008) !== 0; }
function isPublic(flags)    { return (flags & 0x0001) !== 0; }
function isPrivate(flags)   { return (flags & 0x0004) !== 0; }
function isProtected(flags) { return (flags & 0x0002) !== 0; }

function accessBadge(flags) {
  if (isPublic(flags))    return { label: '+', cls: 'badge-public' };
  if (isPrivate(flags))   return { label: '−', cls: 'badge-private' };
  if (isProtected(flags)) return { label: '#', cls: 'badge-protected' };
  return                         { label: '~', cls: 'badge-package' };
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
