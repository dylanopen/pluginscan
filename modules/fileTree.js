/**
 * modules/fileTree.js
 * Renders the class list sidebar and wires up click + search filter.
 *
 * @param {Map<string, ClassInfo>} classMap
 * @param {function}               onSelect - callback(className)
 */
export function renderTree(classMap, onSelect) {
  const list   = document.getElementById('tree-list');
  const search = document.getElementById('search-input');
  const count  = document.getElementById('file-count-label');

  const names = [...classMap.keys()].sort();
  count.textContent = `${names.length} class${names.length !== 1 ? 'es' : ''}`;

  list.innerHTML = '';
  const items = names.map(name => buildItem(name, classMap.get(name), onSelect));
  items.forEach(el => list.appendChild(el));

  if (items.length > 0) items[0].click();

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    items.forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  });
}

function buildItem(name, info, onSelect) {
  const li = document.createElement('li');
  li.className    = 'tree-item';
  li.dataset.name = name.toLowerCase();
  li.textContent  = name.split('.').pop();
  li.title        = name;

  // Dim classes that failed to parse
  if (info.parseError) li.classList.add('tree-item-error');

  li.addEventListener('click', () => {
    document.querySelectorAll('#tree-list .tree-item').forEach(el => el.classList.remove('active'));
    li.classList.add('active');
    onSelect(name);
  });

  return li;
}
