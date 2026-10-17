'use strict';

/* ============ CONFIG ============ */
const DB_NAME = 'cyber-closet';
const STORE_ITEMS = 'items';
const STORE_INSPO = 'inspo';

const CATEGORIES = {
  superior:   { label: 'Superiores',  types: ['Hoodie', 'Camiseta', 'Crop top', 'Chaqueta', 'Top'] },
  inferior:   { label: 'Inferiores',  types: ['Cargo', 'Jean', 'Falda', 'Short', 'Pantalón'] },
  calzado:    { label: 'Calzado',     types: ['Sneakers', 'Botas', 'Plataformas'] },
  accesorios: { label: 'Accesorios',  types: ['Gorro', 'Bolso', 'Cadena', 'Lentes'] }
};

const COLORS = [
  ['Negro', '#111111'], ['Blanco', '#f5f5f5'], ['Gris', '#8a8a95'], ['Beige', '#d9c3a0'],
  ['Azul', '#2457d6'], ['Celeste', '#00c8e0'], ['Verde', '#2e9e5b'], ['Rojo', '#d62839'],
  ['Rosa', '#ff2a85'], ['Morado', '#7b3fe4']
];

const state = { items: [], inspo: [], cat: 'todas', style: null, q: '', sort: 'recent', editId: null, img: null };

const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* ============ TOASTS ============ */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3200);
}

/* ============ INDEXEDDB ============ */
const DB_BLOCKED_MESSAGE = 'La base de datos está bloqueada por otra pestaña. Cierra las otras pestañas de My Cyber Closet.';
let dbPromise;
let dbBlocked = false;
function getDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      [STORE_ITEMS, STORE_INSPO].forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onblocked = () => {
      dbBlocked = true;
      showError(DB_BLOCKED_MESSAGE);
      toast(DB_BLOCKED_MESSAGE, 'err');
    };
    req.onsuccess = () => {
      const db = req.result;
      dbBlocked = false;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function run(store, mode, fn) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const dbAll = s => run(s, 'readonly', st => st.getAll());
const dbPut = (s, v) => run(s, 'readwrite', st => st.put(v));
const dbDelete = (s, id) => run(s, 'readwrite', st => st.delete(id));

/* ============ IMÁGENES Y COLOR ============ */
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('El navegador no pudo abrir la imagen. Si es HEIC/HEIF, conviértela a JPG o PNG.'));
    i.src = src;
  });
}
function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function compress(file, max = 900) {
  const img = await loadImage(await readFile(file));
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo procesar esta imagen.');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/webp', 0.85);
}
// Colores dominantes de una foto (hasta 3), ignorando fondos casi blancos
async function dominantColors(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 40, 40);
  const d = ctx.getImageData(0, 0, 40, 40).data, bins = {};
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i] >> 5, g = d[i + 1] >> 5, b = d[i + 2] >> 5;
    if (r > 6 && g > 6 && b > 6) continue;
    const k = `${r},${g},${b}`;
    (bins[k] ??= { n: 0, r: 0, g: 0, b: 0 });
    bins[k].n++; bins[k].r += d[i]; bins[k].g += d[i + 1]; bins[k].b += d[i + 2];
  }
  return Object.values(bins).sort((a, b) => b.n - a.n).slice(0, 3)
    .map(v => [Math.round(v.r / v.n), Math.round(v.g / v.n), Math.round(v.b / v.n)]);
}
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/* ============ NAVEGACIÓN ============ */
$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));$$
('.view').forEach(v => v.hidden = v.id !== `view-${btn.dataset.view}`);
}));

/* ============ CLÓSET ============ */
function filtered() {
  const q = norm(state.q.trim());
  const list = state.items.filter(i =>
    (state.cat === 'todas' || i.category === state.cat) &&
    (!state.style || i.style === state.style) &&
    (!q || norm(`${i.name} ${i.color} ${i.type} ${i.style}`).includes(q)));
  const s = { recent: (a, b) => b.createdAt - a.createdAt, old: (a, b) => a.createdAt - b.createdAt, name: (a, b) => a.name.localeCompare(b.name, 'es') }[state.sort];
  return list.sort(s);
}

function renderTabs() {
  const count = k => state.items.filter(i => i.category === k).length;
  $('#tabs').innerHTML =
    `<button type="button" class="tab-btn ${state.cat === 'todas' ? 'active' : ''}" data-cat="todas">Todas (${state.items.length})</button>` +
    Object.entries(CATEGORIES).map(([k, v]) =>
      `<button type="button" class="tab-btn ${state.cat === k ? 'active' : ''}" data-cat="${k}">${v.label} (${count(k)})</button>`).join('');
}

function renderGrid() {
  const list = filtered();
  $('#closet-summary').textContent = `${state.items.length} prendas · ${state.inspo.length} fotos de inspo`;
  $('#grid').innerHTML = list.length ? list.map(i => `
    <article class="card" data-action="edit" data-id="${i.id}" tabindex="0">
      <div class="card-media"><img src="${i.image}" alt="${esc(i.name)}" loading="lazy"></div>
      <div class="card-body">
        <div class="card-title">${esc(i.name)}</div>
        <div class="card-meta"><span class="dot" style="background:${esc(i.hex)}"></span>${esc(i.color)} · ${esc(i.style)} · ${esc(i.fit || 'Regular')}</div>
      </div>
      <button type="button" class="card-del" data-action="del" data-id="${i.id}" aria-label="Eliminar ${esc(i.name)}">×</button>
    </article>`).join('')
    : `<div class="empty"><strong>${state.items.length ? 'Sin resultados' : 'Tu clóset está vacío'}</strong>${state.items.length ? 'Prueba con otro filtro o búsqueda.' : 'Usa “Agregar prenda” para subir tu primera prenda.'}</div>`;
}

const refresh = () => { renderTabs(); renderGrid(); renderInspo(); };

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  state.cat = b.dataset.cat; renderTabs(); renderGrid();
});
$('#style-chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.style = state.style === b.dataset.style ? null : b.dataset.style; $$('.chip').forEach(c => c.classList.toggle('active', c.dataset.style === state.style));
  renderGrid();
});
$('#search').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });
$('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });

$('#grid').addEventListener('click', async e => {
  const del = e.target.closest('[data-action="del"]');
  if (del) { e.stopPropagation(); return removeItem(del.dataset.id); }
  const card = e.target.closest('[data-action="edit"]');
  if (card) openDialog(card.dataset.id);
});
$('#grid').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[data-action="edit"]')) openDialog(e.target.dataset.id);
});

async function removeItem(id) {
  const it = state.items.find(i => i.id === id);
  if (!it || !confirm(`¿Eliminar “${it.name}”?`)) return false;
  try {
    await dbDelete(STORE_ITEMS, id);
    state.items = state.items.filter(i => i.id !== id);
    refresh(); toast('Prenda eliminada');
    return true;
  } catch { toast('No se pudo eliminar', 'err'); return false; }
}

/* ============ DIÁLOGO PRENDA ============ */
const dialog = $('#item-dialog');
const form = $('#cloth-form');

function fillTypes(selected) {
  $('#cloth-type').innerHTML = CATEGORIES[$('#cloth-category').value].types
    .map(t => `<option ${t === selected ? 'selected' : ''}>${t}</option>`).join('');
}
function setColor(hex, name) {
  $('#cloth-hex').value = hex;
  if (name !== undefined) $('#cloth-color').value = name; $$('.swatch').forEach(s => s.classList.toggle('active', s.dataset.hex === hex));
}
function showPreview(src) {
  const p = $('#preview'); p.hidden = !src; if (src) p.src = src;
}
function showError(msg) { const e = $('#form-error'); e.hidden = !msg; e.textContent = msg || ''; }

$('#swatches').innerHTML = COLORS.map(([n, h]) =>
  `<button type="button" class="swatch" style="background:${h}" data-hex="${h}" data-name="${n}" title="${n}" aria-label="${n}"></button>`).join('');
$('#swatches').addEventListener('click', e => {
  const s = e.target.closest('.swatch'); if (s) setColor(s.dataset.hex, s.dataset.name);
});
$('#cloth-hex').addEventListener('input', e => { $$('.swatch').forEach(s => s.classList.toggle('active', s.dataset.hex === e.target.value));
  if (!$('#cloth-color').value.trim()) $('#cloth-color').value = 'Personalizado';
});
$('#cloth-category').addEventListener('change', () => fillTypes());

function openDialog(id = null) {
  state.editId = id; state.img = null; showError('');
  const it = id ? state.items.find(i => i.id === id) : null;
  form.reset();
  $('#dialog-title').textContent = it ? 'Editar prenda' : 'Agregar prenda';
  $('#btn-save').textContent = it ? 'Guardar cambios' : 'Guardar prenda';
  $('#btn-delete-dialog').hidden = !it;
  $('#cloth-category').value = it?.category || 'superior';
  fillTypes(it?.type);
  $('#cloth-name').value = it?.name || '';
  
  // Seleccionar radio buttons de estilo y fit correctamente sin colisionar
  const styleVal = it?.style || 'Streetwear';
  const fitVal = it?.fit || 'Regular';
  const styleRadio = form.querySelector(`input[name="style"][value="${styleVal}"]`);
  if (styleRadio) styleRadio.checked = true;
  const fitRadio = form.querySelector(`input[name="fit"][value="${fitVal}"]`);
  if (fitRadio) fitRadio.checked = true;

  setColor(it?.hex || '#111111', it?.color || 'Negro');
  state.img = it?.image || null;
  showPreview(state.img);
  dialog.showModal();
  if (dbBlocked) showError(DB_BLOCKED_MESSAGE);
}

async function handleClothFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Selecciona un archivo de imagen', 'err');
  try {
    state.img = await compress(file);
    showPreview(state.img);
    const [c] = await dominantColors(state.img);
    if (c && (!$('#cloth-color').value.trim() || $('#cloth-color').value === 'Negro')) {
      setColor(rgbToHex(c), 'Personalizado');
    }
  } catch { toast('No se pudo leer la imagen', 'err'); }
}
$('#cloth-image').addEventListener('change', e => handleClothFile(e.target.files[0]));
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('drag')));
dz.addEventListener('drop', e => { e.preventDefault(); handleClothFile(e.dataTransfer.files[0]); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#cloth-name').value.trim(), color = $('#cloth-color').value.trim();
  if (!state.img) return showError('Sube una foto de la prenda.');
  if (!name) return showError('Escribe el nombre de la prenda.');
  if (!color) return showError('Indica el nombre del color.');

  // Uso de FormData para extraer de manera segura los radio buttons sin conflicto con .style
  const formData = new FormData(form);
  const prev = state.items.find(i => i.id === state.editId);

  const item = {
    id: prev?.id || uid('item'), createdAt: prev?.createdAt || Date.now(),
    name, color, hex: $('#cloth-hex').value, image: state.img,
    category: $('#cloth-category').value, type: $('#cloth-type').value,
    style: formData.get('style') || 'Streetwear',
    fit: formData.get('fit') || 'Regular'
  };

  const saveButton = $('#btn-save');
  saveButton.disabled = true;
  saveButton.textContent = 'Guardando...';
  try {
    await dbPut(STORE_ITEMS, item);
    state.items = prev ? state.items.map(i => i.id === item.id ? item : i) : [...state.items, item];
    dialog.close(); refresh(); toast(prev ? 'Cambios guardados' : 'Prenda guardada');
  } catch (error) {
    showError(`No se pudo guardar la prenda: ${error.message || 'revisa el espacio disponible del navegador.'}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = state.editId ? 'Guardar cambios' : 'Guardar prenda';
  }
});

$('#btn-close').addEventListener('click', () => dialog.close());
$('#btn-cancel').addEventListener('click', () => dialog.close());
$('#btn-add').addEventListener('click', () => openDialog());
$('#btn-delete-dialog').addEventListener('click', async () => { if (await removeItem(state.editId)) dialog.close(); });
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

/* ============ INSPO ============ */
$('#btn-add-inspo').addEventListener('click', () => $('#inspo-input').click());
$('#inspo-input').addEventListener('change', async e => {
  const input = e.currentTarget;
  const files = [...input.files];
  if (!files.length) return;
  const button = $('#btn-add-inspo');
  button.disabled = true;
  button.textContent = 'Subiendo fotos...';
  let ok = 0;
  for (const file of files) {
    try {
      if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen compatible.');
      const image = await compress(file, 800);
      const rec = { id: uid('inspo'), image, palette: await dominantColors(image), createdAt: Date.now() };
      await dbPut(STORE_INSPO, rec);
      state.inspo.push(rec); ok++;
    } catch (error) {
      const reason = error.name === 'QuotaExceededError'
        ? 'No queda espacio disponible en el almacenamiento de este navegador.'
        : error.message || 'Error desconocido.';
      toast(`No se pudo subir ${file.name}: ${reason}`, 'err');
    }
  }
  input.value = '';
  button.disabled = false;
  button.textContent = 'Subir fotos de inspo';
  if (ok) { refresh(); toast(`${ok} foto(s) de inspo agregadas`); }
});

function renderInspo() {
  $('#inspo-grid').innerHTML = state.inspo.length ? state.inspo.map(i => `
    <article class="card">
      <div class="card-media"><img src="${i.image}" alt="Inspiración" loading="lazy"></div>
      <div class="palette">${(i.palette || []).map(c => `<i style="background:${rgbToHex(c)}"></i>`).join('')}</div>
      <button type="button" class="card-del" data-id="${i.id}" aria-label="Eliminar inspo">×</button>
    </article>`).join('')
    : `<div class="empty"><strong>Aún no hay inspiración</strong>Sube fotos de Pinterest para que el estilista copie tus paletas favoritas.</div>`;
}
$('#inspo-grid').addEventListener('click', async e => {
  const b = e.target.closest('.card-del'); if (!b || !confirm('¿Eliminar esta foto de inspo?')) return;
  await dbDelete(STORE_INSPO, b.dataset.id);
  state.inspo = state.inspo.filter(i => i.id !== b.dataset.id);
  refresh(); toast('Inspo eliminada');
});

/* ============ ESTILISTA ============ */
function harmony(rgbs) {
  const hsl = rgbs.map(rgbToHsl), neutral = ([, s, l]) => s < 0.18 || l < 0.15 || l > 0.88;
  let sc = 0;
  for (let i = 0; i < hsl.length; i++) for (let j = i + 1; j < hsl.length; j++) {
    if (neutral(hsl[i]) || neutral(hsl[j])) { sc += 1; continue; }
    const d = Math.abs(hsl[i][0] - hsl[j][0]), dh = Math.min(d, 360 - d);
    sc += dh < 30 ? 1 : dh > 150 ? 1 : -1;
  }
  return sc;
}

function inspoMatch(rgbs) {
  let best = { score: 0, ref: null };
  for (const ref of state.inspo) {
    if (!ref.palette?.length) continue;
    const score = rgbs.reduce((a, c) =>
      a + 1 - Math.min(...ref.palette.map(p => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]))) / 441, 0);
    if (score > best.score) best = { score, ref };
  }
  return best;
}
const pick = a => a[Math.floor(Math.random() * a.length)];

function buildOutfit(pool) {
  const top = pick(pool.superior), bottom = pick(pool.inferior), shoes = pick(pool.calzado);
  const acc = pool.accesorios.length && Math.random() < 0.6 ? pick(pool.accesorios) : null;
  const parts = [top, bottom, shoes, acc].filter(Boolean);
  const rgbs = parts.map(p => hexToRgb(p.hex));
  const styles = parts.map(p => p.style);
  let score = harmony(rgbs);
  score += (styles.filter(s => s === styles[0]).length - 1) * 0.6;
  score += top.fit !== bottom.fit ? 0.8 : -0.4;
  const m = inspoMatch(rgbs); score += m.score * 1.5;
  return { parts, score, ref: m.ref };
}

function generate() {
  const style = $('#outfit-style').value;
  const pool = {};
  for (const k of Object.keys(CATEGORIES)) pool[k] = state.items.filter(i => i.category === k && (!style || i.style === style));
  const missing = ['superior', 'inferior', 'calzado'].filter(k => !pool[k].length);
  const box = $('#outfit-result');
  if (missing.length) {
    box.innerHTML = `<div class="empty"><strong>Faltan prendas${style ? ` de estilo ${esc(style)}` : ''}</strong>Agrega al menos una prenda en: ${missing.map(k => CATEGORIES[k].label.toLowerCase()).join(', ')}.</div>`;
    return;
  }
  const seen = new Set(), cands = [];
  for (let n = 0; n < 250; n++) {
    const o = buildOutfit(pool), key = o.parts.map(p => p.id).join();
    if (!seen.has(key)) { seen.add(key); cands.push(o); }
  }
  const top3 = cands.sort((a, b) => b.score - a.score).slice(0, 3);
  const max = Math.max(...top3.map(o => o.score), 1);
  box.innerHTML = top3.map((o, i) => `
    <article class="outfit-card-generated">
      <div class="outfit-head">
        <h3>Look ${i + 1}</h3>
        <span class="score">${Math.max(40, Math.min(99, Math.round(o.score / max * 99)))}% match${o.ref ? ' con tu inspo' : ''}</span>
      </div>
      <div class="outfit-body">
        ${o.parts.map(p => `
          <div class="outfit-piece">
            <div class="card-media"><img src="${p.image}" alt="${esc(p.name)}"></div>
            <small>${esc(p.type)}</small><strong>${esc(p.name)}</strong>
          </div>`).join('')}
        ${o.ref ? `<div class="outfit-piece outfit-ref"><div class="card-media"><img src="${o.ref.image}" alt="Referencia"></div><small>Referencia</small></div>` : ''}
      </div>
    </article>`).join('');
}
$('#btn-generate').addEventListener('click', generate);

/* ============ BACKUP ============ */
$('#btn-export').addEventListener('click', () => {
  if (!state.items.length && !state.inspo.length) return toast('No hay datos para exportar', 'err');
  const blob = new Blob([JSON.stringify({ app: DB_NAME, version: 2, items: state.items, inspo: state.inspo })], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `cyber-closet-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Copia de seguridad exportada');
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items) && !Array.isArray(data.inspo)) throw new Error();
    const items = (data.items || []).filter(i => i?.id && i.image && i.name && CATEGORIES[i.category]);
    const inspo = (data.inspo || []).filter(i => i?.id && i.image);
    if (!confirm(`Se importarán ${items.length} prendas y ${inspo.length} fotos de inspo. Si ya existen, se actualizarán. ¿Continuar?`)) return;
    for (const i of items) await dbPut(STORE_ITEMS, i);
    for (const i of inspo) {
      if (!i.palette) i.palette = await dominantColors(i.image).catch(() => []);
      await dbPut(STORE_INSPO, i);
    }
    state.items = await dbAll(STORE_ITEMS); state.inspo = await dbAll(STORE_INSPO);
    refresh(); toast('Copia importada correctamente');
  } catch { toast('El archivo no es una copia válida', 'err'); }
});

/* ============ INICIO ============ */
async function protectStoredData() {
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return;
  try {
    if (await navigator.storage.persisted()) return;
    const persisted = await navigator.storage.persist();
    if (!persisted && !localStorage.getItem('cyber-closet-storage-notice')) {
      localStorage.setItem('cyber-closet-storage-notice', 'shown');
      toast('El navegador no garantizó el almacenamiento permanente. Usa Exportar para conservar una copia.', 'err');
    }
  } catch (error) {
    console.error('No se pudo solicitar almacenamiento permanente:', error);
    toast('No se pudo verificar la conservación de tus datos. Usa Exportar para guardar una copia.', 'err');
  }
}

async function init() {
  fillTypes();
  await protectStoredData();
  try {
    state.items = await dbAll(STORE_ITEMS);
    state.inspo = await dbAll(STORE_INSPO);
    for (const i of state.inspo) if (!i.palette) { i.palette = await dominantColors(i.image).catch(() => []); await dbPut(STORE_INSPO, i); }
  } catch { toast('No se pudo abrir la base de datos del navegador', 'err'); }
  refresh();
}
init();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .catch(error => console.error('No se pudo preparar el modo sin conexión:', error));
}