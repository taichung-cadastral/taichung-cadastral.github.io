/* 臺中市地籍圖 DXF 下載
   資料：data/sections.json（地段索引）＋ data/lots/<地所代碼+段代碼>.json（每段一檔）
   宗地坐標以 TWD97 TM2 保存（公釐整數差分），顯示時才轉成經緯度；DXF 直接輸出原始 TWD97 坐標。 */
(() => {
'use strict';

const DIST = {'01':'中區','02':'東區','03':'南區','04':'西區','05':'北區','06':'西屯區','07':'南屯區','08':'北屯區',
  '09':'豐原區','10':'東勢區','11':'大甲區','12':'清水區','13':'沙鹿區','14':'梧棲區','15':'后里區','16':'神岡區',
  '17':'潭子區','18':'大雅區','19':'新社區','20':'石岡區','21':'外埔區','22':'大安區','23':'烏日區','24':'大肚區',
  '25':'龍井區','26':'霧峰區','27':'太平區','28':'大里區','29':'和平區'};
const LOT_ZOOM = 16;     // 這個縮放級以上才載入、顯示宗地
const LABEL_ZOOM = 18;   // 這個縮放級以上顯示地號
const MAX_LABELS = 900;
const PING = 0.3025;     // 1 m² = 0.3025 坪
const ZONE_ZOOM = 13;    // 這個縮放級以上才載入使用分區圖層

// 非都市土地使用分區及使用地類別代碼（內政部地政司，政府資料開放平臺 dataset 25113）
const NU_ZONE = {AA:'特定農業區',AB:'一般農業區',AC:'鄉村區',AD:'工業區',AE:'森林區',AF:'山坡地保育區',AG:'風景區',AH:'特定專用區',AJ:'國家公園區'};
const NU_USE = {EA:'甲種建築用地',EB:'乙種建築用地',EC:'丙種建築用地',ED:'丁種建築用地',EE:'農牧用地',EF:'礦業用地',EG:'交通用地',
  EH:'水利用地',EJ:'遊憩用地',EK:'古蹟保存用地',EL:'生態保護用地',EM:'國土保安用地',EN:'墳墓用地',EP:'特定目的事業用地',
  EQ:'鹽業用地',ER:'窯業用地',ES:'林業用地',ET:'養殖用地',EZ:'暫未編定'};
// 都市計畫分區類別配色
const ZCAT = [
  ['住', '住宅區', '#f2cf45'], ['商', '商業區', '#e0564a'], ['工', '工業區', '#9a72cf'], ['農', '農業區', '#a8d47f'],
  ['綠', '公園綠地廣場', '#3f9b58'], ['水', '河川排水', '#4b97e3'], ['交', '交通用地', '#a9abb0'],
  ['專', '專用區', '#f0994a'], ['存', '保存區', '#a37450'], ['公', '公共設施用地', '#86b9c9'],
];
const ZCOLOR = Object.fromEntries(ZCAT.map(([k, , c]) => [k, c]));

proj4.defs('EPSG:3826', '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs');
const P = proj4('EPSG:3826', 'WGS84');
const ll = (x, y) => { const [lon, lat] = P.forward([x, y]); return [lat, lon]; };
const tm = (lat, lng) => P.inverse([lng, lat]);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, d = 2) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const lotLabel = no8 => { const m = +no8.slice(0, 4), s = +no8.slice(4); return s ? `${m}-${s}` : `${m}`; };

// ---------- 使用規則與防護 ----------
// 每次最多 MAX_SEL 筆、只能同一行政區。短時間大量操作則冷卻 COOL_MS。
// 注意：這一層在使用者的瀏覽器執行，只擋一般使用與簡單的自動點擊；
// 伺服器端的限制見 cloudflare/worker.js。
const MAX_SEL = 10;
const COOL_MS = 120e3;
const RULES = {
  dl:    { win: 120e3, max: 5,  burstMs: 3000, label: 'DXF 下載' },  // 2 分鐘內最多 5 次；3 秒內連按視為異常
  csv:   { win: 120e3, max: 8,  burstMs: 1500, label: 'CSV 下載' },  // CSV 另外計算，下載 DXF 後可馬上下載 CSV
  query: { win: 60e3,  max: 20, burstMs: 400,  label: '地號查詢' },  // 1 分鐘內最多 20 次
  data:  { win: 120e3, max: 60, burstMs: 0,    label: '地段資料載入' }, // 2 分鐘內最多載入 60 個地段檔
};
const Guard = (() => {
  const KEY = 'tcCadastralGuard';
  let st = { hits: {}, until: 0, why: '' };
  try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const listeners = [];
  let timer = null;
  const tick = () => {
    const left = Math.max(0, st.until - Date.now());
    listeners.forEach(f => f(left, st.why));
    clearTimeout(timer);
    if (left > 0) timer = setTimeout(tick, 1000);
  };
  const block = (why, ms = COOL_MS) => { st.until = Math.max(st.until, Date.now() + ms); st.why = why; persist(); tick(); };
  return {
    onChange(f) { listeners.push(f); tick(); },
    remaining() { return Math.max(0, st.until - Date.now()); },
    block,
    // 記一次操作；超過規則就進入冷卻並回傳 false
    hit(kind) {
      if (this.remaining()) return false;
      const r = RULES[kind], now = Date.now();
      const h = (st.hits[kind] || []).filter(t => now - t < r.win);
      if (r.burstMs && h.length && now - h[h.length - 1] < r.burstMs) { st.hits[kind] = h; block(`${r.label}速度過快`); return false; }
      if (h.length >= r.max) { st.hits[kind] = h; block(`${r.label}次數過多`); return false; }
      h.push(now); st.hits[kind] = h; persist(); return true;
    },
  };
})();
const automated = navigator.webdriver === true;
const BUSY = '操作太頻繁，請稍後再試。';   // Selenium、Puppeteer 等自動化瀏覽器

// ---------- 資料存取 ----------
async function getJSON(path, kind) {
  if (window.EMBED) { const v = window.EMBED[path]; if (!v) throw new Error('找不到 ' + path); return v; }
  if (kind && !Guard.hit(kind)) throw new Error(BUSY);
  try {
    return await loadDataScript(path);
  } catch (err) {
    // 放在網站上時，查出被伺服器拒絕的原因（429／403）
    if (location.protocol.startsWith('http')) {
      const r = await fetch(path.replace(/\.json$/, '.js'), { method: 'HEAD' }).catch(() => null);
      if (r && (r.status === 429 || r.status === 403)) {
        Guard.block('伺服器偵測到大量請求', (+r.headers.get('Retry-After') || 120) * 1000);
        throw new Error(BUSY);
      }
    }
    throw err;
  }
}

// 資料檔是 .js（內容為 cadData("路徑", {...})），用 <script> 載入，
// 這樣直接雙擊 index.html（file://）與放在網站上都能讀取。
const pendingData = {};
window.cadData = (path, obj) => { const p = pendingData[path]; if (p) { delete pendingData[path]; p(obj); } };
function loadDataScript(path) {
  return new Promise((resolve, reject) => {
    const src = path.replace(/\.json$/, '.js');
    pendingData[path] = resolve;
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => { s.remove(); if (pendingData[path]) { delete pendingData[path]; reject(new Error(`資料格式錯誤：${src}`)); } };
    s.onerror = () => { s.remove(); delete pendingData[path]; reject(new Error(`讀取 ${src} 失敗`)); };
    document.head.appendChild(s);
  });
}

const S = { sections: [], byKey: {}, loaded: {}, loading: {}, lots: new Map(), sel: new Map(), layerOn: false, shapes: null, zoneOn: false, attrs: null, zones: {}, zoneLoading: {}, zonePolys: {} };

// ---------- 地圖 ----------
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let C = {};
const readColors = () => { C = { cad: css('--cad'), sel: css('--sel'), ink: css('--ink'), muted: css('--muted') }; };
readColors();

const map = L.map('map', { preferCanvas: true, zoomSnap: 0.5, maxZoom: 21 }).setView([24.14, 120.70], 14);
const renderer = L.canvas({ padding: 0.4, tolerance: 4 });
const nlsc = (layer, name) => L.tileLayer(`https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`,
  { maxNativeZoom: 19, maxZoom: 21, attribution: '底圖 © 內政部國土測繪中心' + (name ? '' : '') });
const bases = {
  '通用電子地圖': nlsc('EMAP'),
  '正射影像': nlsc('PHOTO2'),
};
bases['通用電子地圖'].addTo(map);
L.control.layers(bases, null, { position: 'topright' }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

map.createPane('zonePane').style.zIndex = 350;          // 分區在宗地底下
const zoneRenderer = L.canvas({ pane: 'zonePane', padding: 0.4, tolerance: 2 });
const zoneGroup = L.layerGroup();
const secGroup = L.layerGroup();
const lotGroup = L.layerGroup();
const labelGroup = L.layerGroup();

const lotStyle = on => on
  ? { renderer, color: C.sel, weight: 2.2, fillColor: C.sel, fillOpacity: 0.32 }
  : { renderer, color: C.cad, weight: 0.9, fillColor: C.cad, fillOpacity: 0.03 };
const secStyle = () => ({ renderer, color: C.ink, weight: 2, opacity: 0.55, dashArray: '8 5', fill: true, fillOpacity: 0 });

function status(t) { $('status').textContent = t; }

// ---------- 使用分區 ----------
let attrsP = null;
function ensureAttrs() {
  if (!attrsP) attrsP = getJSON('data/zone-attrs.json').then(j => { S.attrs = j.attrs; }).catch(e => { attrsP = null; throw e; });
  return attrsP;
}
const pctTxt = p => (p >= 100 ? '' : ` ${p}%`);
// 回傳 { kind: 'urban'|'nonurban'|'none', main, lines:[…], short }
function zoneInfo(lot) {
  const z = lot.z;
  if (typeof z === 'string') {
    const [a, b] = z.split('|');
    const t = `${NU_ZONE[a] || `分區代碼 ${a}`}／${NU_USE[b] || (b && b !== '-' ? `使用地代碼 ${b}` : '未登記使用地')}`;
    return { kind: 'nonurban', zone: NU_ZONE[a] || a, use: NU_USE[b] || b, lines: [`非都市土地：${t}`], short: t };
  }
  if (!z || !z.length || !S.attrs) return { kind: 'none', lines: ['無分區資料'], short: '無分區資料' };
  const lines = z.map(([aid, p]) => {
    if (aid < 0) return `未劃分區（多為計畫道路）${pctTxt(p)}`;
    const a = S.attrs[aid], rate = [a[2] && `建蔽率 ${a[2]}%`, a[3] && `容積率 ${a[3]}%`].filter(Boolean).join('、');
    return `${a[0]}${rate ? `（${rate}）` : ''}${pctTxt(p)}`;
  });
  const main = z[0][0] >= 0 ? S.attrs[z[0][0]] : null;
  return { kind: 'urban', main, lines, short: z.map(([aid, p]) => (aid < 0 ? '未劃分區' : S.attrs[aid][0]) + pctTxt(p)).join('、') };
}

// ---------- 幾何工具（輸出 DXF 時判斷分區與宗地是否相交）----------
function bbox(r) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of r) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; }
function inRing([x, y], r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// 輸出 DXF 用：每筆宗地依分區切成色塊（都市計畫分區裁切到宗地範圍；非都市土地依登記分區整筆上色）
const ZACI = { 住: 2, 商: 1, 工: 200, 農: 83, 綠: 94, 水: 150, 交: 8, 專: 30, 存: 34, 公: 131 };
const NU_COLOR = { AA: ['#6fae4f', 92], AB: ['#a8d47f', 83], AC: ['#f2cf45', 2], AD: ['#9a72cf', 200], AE: ['#2e7d4f', 104],
  AF: ['#8fae6b', 72], AG: ['#3f9b58', 94], AH: ['#f0994a', 30], AJ: ['#2e8b57', 102] };
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a) / 2; };
const closeRing = r => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
const openRing = r => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

async function piecesForLots(lots) {
  const pieces = [];
  const urban = lots.filter(l => Array.isArray(l.z) && l.z.some(([aid]) => aid >= 0));
  if (urban.length) await Promise.all([...new Set(urban.map(l => l.d))].map(loadZones));
  for (const l of lots) {
    if (typeof l.z === 'string') {                    // 非都市土地：整筆依使用分區上色
      const code = l.z.split('|')[0], c = NU_COLOR[code];
      if (!c) continue;
      for (const r of l.rings) pieces.push({ layer: '分區_' + (NU_ZONE[code] || code), aci: c[1], rgb: parseInt(c[0].slice(1), 16), rings: [r] });
      continue;
    }
    if (!Array.isArray(l.z)) continue;
    const want = new Set(l.z.map(([aid]) => aid).filter(a => a >= 0));
    if (!want.size) continue;
    const lotGeom = l.rings.map(r => [closeRing(r)]);              // MultiPolygon
    const lotArea = l.rings.reduce((t, r) => t + ringArea(r), 0);
    const lb = l.rings.map(bbox).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    for (const zp of S.zonePolys[l.d] || []) {
      if (!want.has(zp.aid)) continue;
      const b = zp.bb;
      if (b[0] > lb[2] || b[2] < lb[0] || b[1] > lb[3] || b[3] < lb[1]) continue;
      let inter;
      try { inter = polygonClipping.intersection(lotGeom, [zp.rings.map(closeRing)]); } catch { continue; }
      const a = S.attrs[zp.aid], cat = ZCAT.find(c => c[0] === a[6]) || ZCAT[ZCAT.length - 1];
      for (const poly of inter) {
        const rings = poly.map(openRing);
        const area = ringArea(rings[0]) - rings.slice(1).reduce((t, r) => t + ringArea(r), 0);
        if (area < 0.5 || area < lotArea * 0.005) continue;       // 略過兩套圖資邊界誤差造成的細碎片
        pieces.push({ layer: '分區_' + cat[1], aci: ZACI[cat[0]] || 7, rgb: parseInt(cat[2].slice(1), 16), rings });
      }
    }
  }
  return pieces;
}
// 非都市土地建蔽率、容積率上限（非都市土地使用管制規則第 9 條）；其他使用地由目的事業主管機關另定
const NU_RATE = { EA: [60, 240], EB: [60, 240], EC: [40, 120], ED: [70, 300], ER: [60, 120], EG: [40, 120], EJ: [40, 120], EN: [40, 120], EP: [60, 180] };

// DXF 內的地籍清單
function lotTable(sel) {
  const sorted = [...sel].sort((a, b) => a.sec.localeCompare(b.sec, 'zh-Hant') || a.no8.localeCompare(b.no8));
  const rows = [];
  for (const l of sorted) {
    const base = [l.sec, l.label, fmt(l.area)];
    const z = l.z;
    let entries;
    if (typeof z === 'string') {
      const [a, b] = z.split('|'), r = NU_RATE[b];
      entries = [[`${NU_ZONE[a] || a}／${NU_USE[b] || b}`, r ? `${r[0]}%` : '—', r ? `${r[1]}%` : '—']];
    } else if (Array.isArray(z) && z.length && S.attrs) {
      entries = z.map(([aid, p]) => aid < 0 ? [`未劃分區（多為計畫道路）${pctTxt(p)}`, '—', '—']
        : [S.attrs[aid][0] + pctTxt(p), S.attrs[aid][2] ? `${S.attrs[aid][2]}%` : '—', S.attrs[aid][3] ? `${S.attrs[aid][3]}%` : '—']);
    } else entries = [['無分區資料', '—', '—']];
    entries.forEach((e, i) => rows.push([...(i ? ['', '', ''] : base), ...e]));
  }
  const total = sel.reduce((t, l) => t + l.area, 0);
  return {
    title: `地籍清單　臺中市${DIST[sorted[0].d] || ''}`,
    head: ['地段', '地號', '面積(㎡)', '土地使用分區', '建蔽率', '容積率'],
    rows, leftCol: 3,
    total: ['合計', '', fmt(total), `共 ${sel.length} 筆（${fmt(total * PING)} 坪）`, '', ''],
    note: '註：都市計畫分區由地籍圖與都市計畫圖套疊推估；非都市土地建蔽率、容積率為非都市土地使用管制規則第9條上限。僅供參考。',
  };
}

// 地號下方標示的分區簡稱
function zoneLabel(l) {
  const zi = zoneInfo(l);
  if (zi.kind === 'nonurban') return zi.short;
  if (zi.kind !== 'urban') return '';
  return l.z.filter(([aid]) => aid >= 0).map(([aid]) => S.attrs[aid][1] || S.attrs[aid][0]).join('、');
}

// ---------- 地段 ----------
async function init() {
  const idx = await getJSON('data/sections.json');
  S.sections = idx.sections;
  if (idx.version) $('verChip').textContent = '地籍資料 ' + idx.version.replace(/^(\d{3})(\d{2})(\d{2})$/, '$1.$2.$3');
  const dists = [...new Set(S.sections.map(s => s.d))].sort();
  const OLD_CITY = ['01', '02', '03', '04', '05', '06', '07', '08'];
  const old = OLD_CITY.filter(d => dists.includes(d)).map(d => DIST[d]);
  const rest = dists.filter(d => !OLD_CITY.includes(d)).map(d => DIST[d] || d);
  $('scopeChip').textContent = '範圍：' + [old.length ? `舊臺中市（${old.join('、')}）` : '', ...rest].filter(Boolean).join('＋');

  const sel = $('sec');
  for (const d of dists) {
    const og = document.createElement('optgroup'); og.label = DIST[d] || d;
    for (const s of S.sections.filter(s => s.d === d)) {
      const o = document.createElement('option'); o.value = s.k;
      o.textContent = `${s.n}（${s.c}）· ${s.cnt ?? '?'} 筆`; og.appendChild(o);
    }
    sel.appendChild(og);
  }

  const all = L.latLngBounds([]);
  for (const s of S.sections) {
    S.byKey[s.k] = s;
    if (s.b) { all.extend(ll(s.b[0], s.b[1])); all.extend(ll(s.b[2], s.b[3])); }
  }
  if (all.isValid()) map.fitBounds(all, { padding: [20, 20] });
  map.on('moveend zoomend', refresh);
  refresh();
}

// 地籍圖層開關：預設關閉，開啟時才載入地段邊界與宗地，減少讀取時間與流量
async function setLayer(on) {
  S.layerOn = on;
  $('layerOn').checked = on;
  if (!on) {
    for (const g of [secGroup, lotGroup, labelGroup]) map.removeLayer(g);
    status('勾選「開啟地籍圖圖層」後顯示地籍。');
    return;
  }
  secGroup.addTo(map);
  if (!S.shapes) {
    status('載入地段範圍…');
    try { S.shapes = await getJSON('data/sections-shape.json'); } catch (e) { status(e.message); return; }
    for (const s of S.sections) {
      const rings = (S.shapes[s.k] || []).map(r => r.map(([x, y]) => ll(x, y)));
      if (!rings.length) continue;
      const pg = L.polygon(rings, secStyle()).addTo(secGroup);
      pg.on('click', e => { if (map.getZoom() < LOT_ZOOM) { $('sec').value = s.k; fitSection(s.k); L.DomEvent.stop(e); } });
      pg.on('mouseover', () => { if (map.getZoom() < LOT_ZOOM) status(`${DIST[s.d] || ''} ${s.n}（${s.c}）· ${s.cnt} 筆宗地 · 點一下放大`); });
      s.poly = pg;
    }
  }
  refresh();
}
$('layerOn').addEventListener('change', e => setLayer(e.target.checked));

// 使用分區圖層開關：預設關閉，開啟後依畫面範圍載入各行政區分區
const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const div = L.DomUtil.create('div', 'legend');
  div.innerHTML = '<b>都市計畫使用分區</b>' + ZCAT.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('') +
    '<span><i class="none"></i>未劃分區（多為計畫道路）</span><small>非都市土地以地籍登記之分區為準，滑鼠移到宗地上可查看</small>';
  L.DomEvent.disableClickPropagation(div);
  return div;
};
function setZone(on) {
  S.zoneOn = on; $('zoneOn').checked = on;
  if (on) { zoneGroup.addTo(map); legend.addTo(map); ensureAttrs().catch(() => {}); refresh(); }
  else { map.removeLayer(zoneGroup); legend.remove(); }
}
$('zoneOn').addEventListener('change', e => setZone(e.target.checked));

function loadZones(d) {
  if (S.zones[d] || S.zoneLoading[d]) return S.zoneLoading[d];
  S.zoneLoading[d] = Promise.all([getJSON(`data/zones/${d}.json`, 'data'), ensureAttrs()]).then(([j]) => {
    const [ox, oy] = j.o;
    const polys = S.zonePolys[d] = [];
    for (const [aid, rs] of j.z) {
      const tmRings = rs.map(a => { const r = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; r.push([ox + x / 10, oy + y / 10]); } return r; });
      polys.push({ aid, rings: tmRings, bb: bbox(tmRings[0]) });
      const rings = tmRings.map(r => r.map(([x, y]) => ll(x, y)));
      const at = S.attrs[aid];
      const pg = L.polygon(rings, { renderer: zoneRenderer, pane: 'zonePane', color: ZCOLOR[at[6]] || '#999', weight: 0.6, opacity: 0.9, fillColor: ZCOLOR[at[6]] || '#999', fillOpacity: 0.42 });
      pg.on('mouseover', () => status(`${at[0]}${at[1] ? `（${at[1]}）` : ''}${at[2] ? ` · 建蔽率 ${at[2]}%` : ''}${at[3] ? ` · 容積率 ${at[3]}%` : ''} · ${at[5]}`));
      pg.addTo(zoneGroup);
    }
    S.zones[d] = j.b;
  }).catch(err => { delete S.zoneLoading[d]; msg(err.message, 'err'); });
  return S.zoneLoading[d];
}

function fitSection(k) {
  const s = S.byKey[k]; if (!s || !s.b) return;
  map.fitBounds(L.latLngBounds([ll(s.b[0], s.b[1]), ll(s.b[2], s.b[3])]), { padding: [10, 10] });
}

function viewTM() {
  const b = map.getBounds();
  const pts = [b.getSouthWest(), b.getNorthEast(), b.getNorthWest(), b.getSouthEast()].map(p => tm(p.lat, p.lng));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
const hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// ---------- 宗地 ----------
function decode(sec) {
  const [ox, oy] = sec.o;
  return sec.lots.map(([no8, area, lx, ly, rs, z]) => ({
    no8, area, z, lx: ox + lx / 1000, ly: oy + ly / 1000,
    rings: rs.map(a => { const r = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; r.push([ox + x / 1000, oy + y / 1000]); } return r; }),
  }));
}

function loadSection(k) {
  if (S.loaded[k]) return Promise.resolve();
  if (S.loading[k]) return S.loading[k];
  const s = S.byKey[k];
  S.loading[k] = Promise.all([getJSON(`data/lots/${k}.json`, 'data'), ensureAttrs()]).then(([sec]) => {
    for (const L0 of decode(sec)) {
      const id = `${k}|${L0.no8}`;
      const lot = { id, k, sec: s.n, d: s.d, ...L0, label: lotLabel(L0.no8) };
      lot.layer = L.polygon(lot.rings.map(r => r.map(([x, y]) => ll(x, y))), lotStyle(S.sel.has(id)));
      lot.layer.on('click', e => { toggle(id); L.DomEvent.stop(e); });
      lot.layer.on('mouseover', () => status(`${s.n} ${lot.label} 地號 · ${fmt(lot.area)} m²（${fmt(lot.area * PING)} 坪）· ${zoneInfo(lot).short}`));
      lot.layer.addTo(lotGroup);
      S.lots.set(id, lot);
    }
    S.loaded[k] = true;
  }).catch(err => { delete S.loading[k]; msg(err.message, 'err'); throw err; });
  return S.loading[k];
}

let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const z = map.getZoom();
    if (S.zoneOn && z >= ZONE_ZOOM && !Guard.remaining()) {
      const v0 = viewTM();
      const ds = [...new Set(S.sections.filter(s => s.b && hit(s.b, v0)).map(s => s.d))].filter(d => !S.zones[d]);
      if (ds.length) { status('載入使用分區…'); await Promise.allSettled(ds.map(loadZones)); }
    }
    if (!S.layerOn) {
      status(S.zoneOn ? (z < ZONE_ZOOM ? `放大到第 ${ZONE_ZOOM} 級以上顯示使用分區。` : '滑鼠移到色塊可查看分區、建蔽率、容積率。') : '勾選「開啟地籍圖圖層」後顯示地籍。');
      return;
    }
    if (z < LOT_ZOOM) {
      map.removeLayer(lotGroup); map.removeLayer(labelGroup);
      status(`放大到第 ${LOT_ZOOM} 級以上可點選宗地（目前 ${z}）。點地段可直接放大。`);
      return;
    }
    lotGroup.addTo(map);
    const v = viewTM();
    const need = Guard.remaining() ? [] : S.sections.filter(s => s.b && hit(s.b, v) && !S.loaded[s.k]);
    if (need.length) status(`載入 ${need.map(s => s.n).join('、')}…`);
    await Promise.allSettled(need.map(s => loadSection(s.k)));
    status('點宗地可加入或移除選取。');
    drawLabels(v, z);
  }, 120);
}

function drawLabels(v, z) {
  labelGroup.clearLayers();
  if (z < LABEL_ZOOM) { map.removeLayer(labelGroup); return; }
  let n = 0;
  for (const lot of S.lots.values()) {
    if (lot.lx < v[0] || lot.lx > v[2] || lot.ly < v[1] || lot.ly > v[3]) continue;
    if (!S.sel.has(lot.id)) {   // 太小的宗地不標，避免地號疊在一起
      const b = lot.layer.getBounds();
      const w = map.latLngToContainerPoint(b.getNorthEast()).x - map.latLngToContainerPoint(b.getSouthWest()).x;
      if (w < 7 * lot.label.length + 6) continue;
    }
    if (++n > MAX_LABELS) break;
    L.marker(ll(lot.lx, lot.ly), { interactive: false, icon: L.divIcon({ className: 'lotno' + (S.sel.has(lot.id) ? ' on' : ''), html: esc(lot.label), iconSize: [60, 12], iconAnchor: [30, 6] }) }).addTo(labelGroup);
  }
  labelGroup.addTo(map);
}

// ---------- 選取 ----------
const selDist = () => { const f = S.sel.values().next().value; return f ? f.d : null; };

// 回傳 '' 表示成功，否則回傳不能選取的原因
function canAdd(lot) {
  if (S.sel.has(lot.id)) return '';
  const d = selDist();
  if (d && d !== lot.d) return `不能跨區下載：目前已選 ${DIST[d]} 的宗地，這筆在 ${DIST[lot.d]}。請先清除選取再選其他區。`;
  if (S.sel.size >= MAX_SEL) return `一次最多選 ${MAX_SEL} 筆。請先下載或移除部分宗地。`;
  return '';
}

function toggle(id, force, quiet) {
  const lot = S.lots.get(id); if (!lot) return 'missing';
  const on = force ?? !S.sel.has(id);
  if (on) {
    const why = canAdd(lot);
    if (why) { if (!quiet) msg(why, 'err'); return why; }
    S.sel.set(id, lot);
  } else S.sel.delete(id);
  lot.layer.setStyle(lotStyle(on));
  if (on) lot.layer.bringToFront();
  renderSel();
  return '';
}

function renderSel() {
  const lots = [...S.sel.values()].sort((a, b) => a.sec.localeCompare(b.sec, 'zh-Hant') || a.no8.localeCompare(b.no8));
  const n = lots.length, area = lots.reduce((t, l) => t + l.area, 0);
  $('selCount').textContent = `${n} / ${MAX_SEL}`;
  $('selSum').innerHTML = n
    ? `${esc(DIST[lots[0].d] || '')}，共 <b>${n}</b> 筆，登記面積合計 <b>${fmt(area)}</b> m²（<b>${fmt(area * PING)}</b> 坪）`
    : `尚未選取。在地圖上點宗地或用地號查詢加入，一次最多 ${MAX_SEL} 筆、限同一行政區。`;
  $('selList').innerHTML = lots.map(l =>
    `<li data-id="${esc(l.id)}"><span class="nm">${esc(l.sec)} <span class="no">${esc(l.label)}</span></span>` +
    `<span class="ar">${fmt(l.area)} m²</span>` +
    `<button type="button" class="x" aria-label="移除 ${esc(l.sec)} ${esc(l.label)}">×</button>` +
    `<span class="zn">${zoneInfo(l).lines.map(esc).join('<br>')}</span></li>`).join('');
  $('zoneHint').hidden = !n;
  for (const b of ['zoomSel', 'clearSel']) $(b).disabled = !n;
  updateDlButtons();
  if (map.getZoom() >= LABEL_ZOOM) drawLabels(viewTM(), map.getZoom());
}

$('selList').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  const lot = S.lots.get(li.dataset.id);
  if (e.target.closest('.x')) toggle(li.dataset.id, false);
  else if (lot) map.fitBounds(lot.layer.getBounds(), { maxZoom: 20, padding: [40, 40] });
});
$('clearSel').addEventListener('click', () => { for (const id of [...S.sel.keys()]) toggle(id, false); msg(''); });
$('zoomSel').addEventListener('click', zoomSel);
function zoomSel() {
  const b = L.latLngBounds([]); for (const l of S.sel.values()) b.extend(l.layer.getBounds());
  if (b.isValid()) map.fitBounds(b, { maxZoom: 20, padding: [40, 40] });
}

// ---------- 地號查詢 ----------
function parseQuery(q) {
  const want = [], bad = [];
  for (const t of q.trim().split(/[,，、;；\s]+/).filter(Boolean)) {
    let m;
    if ((m = t.match(/^(\d{8})$/))) want.push({ m: +m[1].slice(0, 4), s: +m[1].slice(4), t });
    else if ((m = t.match(/^(\d{1,4})-(\d{1,4})$/))) want.push({ m: +m[1], s: +m[2], t });
    else if ((m = t.match(/^(\d{1,4})-?\*$/))) want.push({ m: +m[1], s: null, t });
    else if ((m = t.match(/^(\d{1,4})[~～](\d{1,4})$/))) {
      const a = +m[1], b = +m[2];
      if (b < a || b - a > 50) bad.push(t); else for (let i = a; i <= b; i++) want.push({ m: i, s: 0, t: String(i) });
    }
    else if ((m = t.match(/^(\d{1,4})$/))) want.push({ m: +m[1], s: 0, t });
    else bad.push(t);
  }
  return { want, bad };
}

function msg(t, cls = '') { const el = $('msg'); el.textContent = t; el.className = 'msg ' + cls; }

$('qform').addEventListener('submit', async e => {
  e.preventDefault();
  const k = $('sec').value, q = $('lotq').value;
  if (!k) return msg('請先選擇地段：在「地段」欄輸入段名後，從清單點選。', 'err');
  const { want, bad } = parseQuery(q);
  if (!want.length) return msg(bad.length ? `看不懂的地號格式：${bad.join('、')}（範圍一次最多 50 號）` : '請輸入地號。', 'err');
  if (!Guard.hit('query')) return msg(BUSY, 'err');
  msg('查詢中…');
  if (!S.layerOn) setLayer(true);
  try { await loadSection(k); } catch { return; }
  const lots = [...S.lots.values()].filter(l => l.k === k);
  const found = [], miss = [];
  for (const w of want) {
    const hits = lots.filter(l => +l.no8.slice(0, 4) === w.m && (w.s === null || +l.no8.slice(4) === w.s));
    if (hits.length) found.push(...hits); else miss.push(w.t);
  }
  const added = [], refused = [];
  let reason = '';
  for (const l of found) {
    const already = S.sel.has(l.id);
    const why = toggle(l.id, true, true);
    if (why) { refused.push(l); reason = reason || why; } else if (!already) added.push(l);
  }
  const s = S.byKey[k];
  let t = added.length ? `已加入 ${s.n} ${added.length} 筆。` : '';
  if (refused.length) t += `${refused.length} 筆未加入：${reason}`;
  if (miss.length) t += `查無：${miss.slice(0, 12).join('、')}${miss.length > 12 ? ` 等 ${miss.length} 個` : ''}。`;
  if (bad.length) t += `格式不符已略過：${bad.join('、')}。`;
  if (!t && found.length) t = '這些宗地已在選取中。';
  msg(t, added.length && !refused.length ? 'ok' : 'err');
  const show = added.length ? added : found;
  if (show.length) {
    const b = L.latLngBounds([]); for (const l of show) b.extend(l.layer.getBounds());
    map.stop();
    map.fitBounds(b, { maxZoom: 19, padding: [40, 40], animate: false });
    if (map.getZoom() < LOT_ZOOM) map.setZoom(LOT_ZOOM, { animate: false });
  }
});
$('sec').addEventListener('change', e => {
  const s0 = S.byKey[e.target.value];
  $('secq').value = s0 ? s0.n : '';
  if (s0) fitSection(s0.k);
});

// ---------- 地段：打字搜尋 ----------
(() => {
  const inp = $('secq'), list = $('secList');
  let items = [], active = -1;
  const norm = t => t.replace(/\s/g, '').replace(/台/g, '臺');
  function search(q) {
    q = norm(q);
    if (!q) return [];
    const hits = [];
    for (const s0 of S.sections) {
      const name = norm(s0.n), dist = DIST[s0.d] || '';
      let score = -1;
      if (s0.c === q || s0.c.replace(/^0+/, '') === q.replace(/^0+/, '')) score = 0;   // 段代碼完全相符
      else if (name.startsWith(q)) score = 1;
      else if (name.includes(q)) score = 2;
      else if (s0.c.includes(q)) score = 3;
      else if (dist.startsWith(q)) score = 4;                                            // 輸入行政區列出該區地段
      if (score >= 0) hits.push([score, s0]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].n.localeCompare(b[1].n, 'zh-Hant'));
    return hits.slice(0, 30).map(h => h[1]);
  }
  const hl = (text, q) => { const i = q ? text.indexOf(q) : -1; return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(q) + '</mark>' + esc(text.slice(i + q.length)); };
  function render() {
    const q = norm(inp.value);
    const cur = S.byKey[$('sec').value];
    if (cur && norm(cur.n) !== q) $('sec').value = '';                  // 改打別的字就取消原本選的地段
    items = search(inp.value);
    active = items.length ? 0 : -1;
    if (!q) { close(); return; }
    list.innerHTML = items.length
      ? items.map((s0, i) => `<li role="option" id="secopt${i}" data-k="${esc(s0.k)}" class="${i === active ? 'active' : ''}">` +
          `<span>${hl(s0.n, q)}（${hl(s0.c, q)}）</span><small>${esc(DIST[s0.d] || '')} · ${s0.cnt} 筆</small></li>`).join('')
      : '<li class="empty">找不到符合的地段</li>';
    list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    inp.setAttribute('aria-activedescendant', active >= 0 ? 'secopt' + active : '');
  }
  function close() { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); }
  function move(d) {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === active));
    const li = list.children[active]; if (li) li.scrollIntoView({ block: 'nearest' });
    inp.setAttribute('aria-activedescendant', 'secopt' + active);
  }
  function pick(k) {
    const s0 = S.byKey[k]; if (!s0) return;
    $('sec').value = k;
    $('sec').dispatchEvent(new Event('change'));
    inp.value = s0.n;
    close();
    $('lotq').focus();
  }
  inp.addEventListener('input', render);
  inp.addEventListener('focus', () => { if (inp.value && norm(inp.value) !== norm(S.byKey[$('sec').value]?.n || '')) render(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); else move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!list.hidden && active >= 0) pick(items[active].k); else if (items.length === 1) pick(items[0].k); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', e => e.preventDefault());          // 避免點選前輸入框先失焦
  list.addEventListener('click', e => { const li = e.target.closest('li[data-k]'); if (li) pick(li.dataset.k); });
  inp.addEventListener('blur', () => setTimeout(close, 100));
})();

// ---------- 下載 ----------
function save(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function baseName() {
  const lots = [...S.sel.values()];
  const first = lots.sort((a, b) => a.sec.localeCompare(b.sec, 'zh-Hant') || a.no8.localeCompare(b.no8))[0];
  const dists = [...new Set(lots.map(l => DIST[l.d] || l.d))];
  const name = `臺中市${dists.join('')}_${first.sec}${first.label}${lots.length > 1 ? `等${lots.length}筆` : ''}`;
  return name.replace(/[\\/:*?"<>|]/g, '_');
}
// 下載前再檢查一次規則（避免有人改動頁面狀態繞過）
function checkDownload(kind) {
  const lots = [...S.sel.values()];
  if (automated) return '偵測到自動化瀏覽器，本站不提供自動下載。';
  if (!lots.length) return '尚未選取宗地。';
  if (lots.length > MAX_SEL) return `一次最多下載 ${MAX_SEL} 筆。`;
  if (new Set(lots.map(l => l.d)).size > 1) return '不能跨區下載，請只保留同一行政區的宗地。';
  if (!Guard.hit(kind)) return BUSY;
  return '';
}
function updateDlButtons() {
  const off = !S.sel.size;
  $('dlDxf').disabled = off; $('dlCsv').disabled = off;
}
function dlmsg(t, cls = '') { const el = $('dlmsg'); el.textContent = t; el.className = 'msg dlmsg ' + cls; }
$('dlDxf').addEventListener('click', async () => {
  const why = checkDownload('dl'); if (why) return dlmsg(why, 'err');
  const sel = [...S.sel.values()];
  let pieces = [];
  try { dlmsg('整理使用分區…'); pieces = await piecesForLots(sel); } catch (e) { dlmsg('使用分區載入失敗，DXF 只含宗地。', 'err'); }
  const lots = sel.map(l => ({ sec: l.sec, no: l.label, rings: l.rings, lx: l.lx, ly: l.ly, zlabel: zoneLabel(l) }));
  save(baseName() + '_地籍圖.dxf', buildDXF(lots, window.DXF_TPL, window.DXF_OWNER, pieces, lotTable(sel)), 'application/dxf');
  dlmsg(`已下載 DXF：宗地 ${lots.length} 筆${pieces.length ? `，分區色塊 ${pieces.length} 塊` : ''}。`, 'ok');
});
$('dlCsv').addEventListener('click', () => {
  const why = checkDownload('csv'); if (why) return dlmsg(why, 'err');
  const rows = [['行政區', '地段', '段代碼', '地號', '登記面積(m2)', '登記面積(坪)', '都市計畫使用分區(含比例)', '主要分區建蔽率(%)', '主要分區容積率(%)', '都市計畫區', '非都市使用分區', '非都市使用地類別', 'TWD97_E', 'TWD97_N']];
  for (const l of [...S.sel.values()].sort((a, b) => a.sec.localeCompare(b.sec, 'zh-Hant') || a.no8.localeCompare(b.no8)))
  {
    const zi = zoneInfo(l), m = zi.main;
    rows.push([DIST[l.d] || l.d, l.sec, S.byKey[l.k].c, l.label, l.area.toFixed(2), (l.area * PING).toFixed(2),
      zi.kind === 'urban' ? zi.short : '', m ? m[2] : '', m ? m[3] : '', m ? m[5] : '',
      zi.kind === 'nonurban' ? zi.zone : '', zi.kind === 'nonurban' ? zi.use : '', l.lx.toFixed(3), l.ly.toFixed(3)]);
  }
  save(baseName() + '_清單.csv', '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
  dlmsg(`已下載清單 CSV（${S.sel.size} 筆）。`, 'ok');
});

// 主題切換時重新套用地圖顏色
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  readColors();
  secGroup.eachLayer(l => l.setStyle(secStyle()));
  /* 分區配色不隨主題改變 */
  for (const l of S.lots.values()) l.layer.setStyle(lotStyle(S.sel.has(l.id)));
});

// 冷卻結束後恢復載入地段（不顯示倒數）
let wasBlocked = false;
Guard.onChange(left => {
  const blocked = left > 0;
  if (wasBlocked && !blocked) refresh();
  wasBlocked = blocked;
});

window.__app = { S, map, parseQuery, Guard, load: loadSection };   // 供測試
init().catch(err => { status('載入失敗：' + err.message); msg(err.message, 'err'); });
})();
