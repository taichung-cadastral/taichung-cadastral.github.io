// 由選取的宗地產生 AutoCAD 2010 (AC1024) DXF，坐標為 TWD97 TM2（公尺）
// lots:   [{sec:'旱溪段', no:'123-4', rings:[[[x,y],...],...], lx, ly, zlabel:'住三'}]
// pieces: [{layer:'分區_住宅區', aci:2, rgb:0xF2CF45, rings:[[[x,y],...](外框), [...](內洞)...]}]
//         宗地內各分區的色塊（已裁切到宗地範圍）
// table:  {title, head:[...], rows:[[...], ...], total:[...], note}  畫在宗地右側空白處的地籍清單
// 只輸出有用到的圖層；繪製順序：分區色塊（HATCH，50% 透明）→ 宗地界 → 文字
function buildDXF(lots, TPL, OWNER, pieces, table) {
  let h = 0x1000; // 起始 handle，高於範本內的 $HANDSEED
  const H = () => (h++).toString(16).toUpperCase();
  const f = v => (Math.round(v * 1000) / 1000).toFixed(3);
  const out = [];
  const head = (type, layer, extra) => {
    out.push('  0', type, '  5', H(), '330', OWNER, '100', 'AcDbEntity', '  8', layer);
    if (extra) out.push(...extra);
  };
  const text = (layer, x, y, ht, s, left) => {      // 預設置中；left=true 靠左（垂直皆置中）
    head('TEXT', layer);
    out.push('100', 'AcDbText', ' 10', f(x), ' 20', f(y), ' 30', '0.0', ' 40', f(ht), '  1', s,
      '  7', 'CHT', ' 72', left ? '0' : '1', ' 11', f(x), ' 21', f(y), ' 31', '0.0', '100', 'AcDbText', ' 73', '2');
  };
  const line = (layer, x1, y1, x2, y2) => {
    head('LINE', layer);
    out.push('100', 'AcDbLine', ' 10', f(x1), ' 20', f(y1), ' 30', '0.0', ' 11', f(x2), ' 21', f(y2), ' 31', '0.0');
  };
  pieces = pieces || [];

  // 分區色塊
  for (const P of pieces) {
    head('HATCH', P.layer, [' 62', String(P.aci), '420', String(P.rgb), '440', '33554559']);   // 透明度 50%
    out.push('100', 'AcDbHatch', ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', '210', '0.0', '220', '0.0', '230', '1.0',
      '  2', 'SOLID', ' 70', '1', ' 71', '0', ' 91', String(P.rings.length));
    P.rings.forEach((r, i) => {
      out.push(' 92', i === 0 ? '3' : '2', ' 72', '0', ' 73', '1', ' 93', String(r.length));
      for (const [x, y] of r) out.push(' 10', f(x), ' 20', f(y));
      out.push(' 97', '0');
    });
    out.push(' 75', '0', ' 76', '1', ' 98', '0');
  }
  // 宗地界、地號、分區簡稱、段名
  const secPts = {};
  for (const L of lots) {
    for (const r of L.rings) {
      head('LWPOLYLINE', '宗地界');
      out.push('100', 'AcDbPolyline', ' 90', String(r.length), ' 70', '1', ' 43', '0.0');
      for (const [x, y] of r) out.push(' 10', f(x), ' 20', f(y));
    }
    text('地號', L.lx, L.ly, 0.8, L.no);
    if (L.zlabel) text('分區_名稱', L.lx, L.ly - 1.0, 0.6, L.zlabel);
    (secPts[L.sec] = secPts[L.sec] || []).push([L.lx, L.ly]);
  }
  for (const [name, pts] of Object.entries(secPts)) {
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    text('段名', x, y + 3, 2.5, name);
  }

  // 地籍清單（宗地右側）
  const extraLayers = [];
  if (table && table.rows.length) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const L of lots) for (const r of L.rings) for (const [x, y] of r) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const span = Math.max(bx1 - bx0, by1 - by0);
    const th = Math.min(5, Math.max(0.6, span / 45));            // 清單字高隨圖面大小調整
    const rh = th * 2.0, pad = th * 0.6;
    const tw = s => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.62), 0) * th;  // 估計字寬
    const all = [table.head, ...table.rows, table.total].filter(Boolean);
    const widths = table.head.map((_, i) => Math.max(...all.map(r => tw(r[i] ?? ''))) + pad * 2);
    const x0 = bx1 + Math.max(th * 4, span * 0.08), y0 = by1;
    const W = widths.reduce((a, b) => a + b, 0);
    const L = '地籍清單';
    text(L, x0, y0 + rh * 0.7, th * 1.3, table.title, true);
    const rows = all.length;
    for (let i = 0; i <= rows; i++) line(L, x0, y0 - i * rh, x0 + W, y0 - i * rh);
    let cx = x0;
    for (let c = 0; c <= widths.length; c++) {
      const isTotalMerge = table.total && c === 1;           // 合計列前兩欄合併
      line(L, cx, y0, cx, y0 - (isTotalMerge ? rows - 1 : rows) * rh);
      if (c < widths.length) cx += widths[c];
    }
    all.forEach((r, ri) => {
      let x = x0;
      const y = y0 - (ri + 0.5) * rh;
      r.forEach((v, c) => {
        const w = widths[c];
        if (v !== '' && v != null) {
          if (table.total && ri === rows - 1 && c === 0) text(L, x0 + (widths[0] + widths[1]) / 2, y, th, v);
          else if (c === table.leftCol && ri > 0) text(L, x + pad, y, th, v, true);
          else text(L, x + w / 2, y, th, v);
        }
        x += w;
      });
    });
    if (table.note) text(L, x0, y0 - rows * rh - th * 1.2, th * 0.7, table.note, true);
    extraLayers.push({ layer: L, aci: 7 });
  }

  let dxf = TPL;

  // 開啟時的畫面：視窗中心放在地籍（含地籍清單）的中間，並縮放到全部看得到。
  // 否則 AutoCAD 開啟時停在原點附近，TWD97 坐標的圖形在畫面外，看起來像空白。
  let ex0 = Infinity, ey0 = Infinity, ex1 = -Infinity, ey1 = -Infinity;
  const grow = (x, y) => { if (x < ex0) ex0 = x; if (y < ey0) ey0 = y; if (x > ex1) ex1 = x; if (y > ey1) ey1 = y; };
  for (let i = 0; i < out.length - 3; i++) {
    if (out[i] === ' 10' && out[i + 2] === ' 20') { const x = +out[i + 1], y = +out[i + 3]; if (x || y) grow(x, y); }
    else if (out[i] === ' 11' && out[i + 2] === ' 21') { const x = +out[i + 1], y = +out[i + 3]; if (x || y) grow(x, y); }
  }
  if (ex0 <= ex1) {
    const cx = (ex0 + ex1) / 2, cy = (ey0 + ey1) / 2;
    const vh = Math.max(ey1 - ey0, (ex1 - ex0) / 1.6, 10) * 1.12;   // 以 16:10 螢幕估算，四周留白
    const F = v => v.toFixed(3);
    dxf = dxf
      .replace(/(\$EXTMIN\n 10\n)[^\n]+\n 20\n[^\n]+\n 30\n[^\n]+/, `$1${F(ex0)}\n 20\n${F(ey0)}\n 30\n0.0`)
      .replace(/(\$EXTMAX\n 10\n)[^\n]+\n 20\n[^\n]+\n 30\n[^\n]+/, `$1${F(ex1)}\n 20\n${F(ey1)}\n 30\n0.0`)
      // VPORT *Active：12/22 視窗中心、40 視窗高度、41 長寬比
      .replace(/(\*Active\n[\s\S]*? 12\n)[^\n]+\n 22\n[^\n]+/, `$1${F(cx)}\n 22\n${F(cy)}`)
      .replace(/(\*Active\n[\s\S]*? 40\n)[^\n]+\n 41\n[^\n]+/, `$1${F(vh)}\n 41\n1.6`)
      // 模型配置的圖形範圍
      .replace(/(AcDbLayout\n  1\nModel\n[\s\S]*? 14\n)[^\n]+\n 24\n[^\n]+\n 34\n[^\n]+\n 15\n[^\n]+\n 25\n[^\n]+\n 35\n[^\n]+/,
        `$1${F(ex0)}\n 24\n${F(ey0)}\n 34\n0.0\n 15\n${F(ex1)}\n 25\n${F(ey1)}\n 35\n0.0`);
  }

  // 圖層表：加入用到的分區圖層，移除沒用到的基本圖層（0 號圖層保留）
  const used = new Set(out.filter((v, i) => out[i - 1] === '  8'));
  const zl = [...new Map(pieces.map(p => [p.layer, p])).values(), ...extraLayers];
  const recs = zl.map(p => ['  0', 'LAYER', '  5', H(), '330', '1', '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord',
    '  2', p.layer, ' 70', '0', ' 62', String(p.aci), ...(p.rgb != null ? ['420', String(p.rgb)] : []), '  6', 'Continuous', '370', '-3', '390', '13', '347', '21'].join('\n'));
  const li = dxf.indexOf('  2\nLAYER\n'), le = dxf.indexOf('  0\nENDTAB\n', li);
  let ltab = dxf.slice(li, le);
  for (const name of ['宗地界', '地號', '段名', '分區_名稱']) {
    if (used.has(name)) continue;
    ltab = ltab.replace(new RegExp(`  0\\nLAYER\\n  5\\n[0-9A-F]+\\n330\\n1\\n100\\nAcDbSymbolTableRecord\\n100\\nAcDbLayerTableRecord\\n  2\\n${name}\\n[\\s\\S]*?(?=  0\\n)`), '');
  }
  ltab += recs.length ? recs.join('\n') + '\n' : '';
  const count = (ltab.match(/  0\nLAYER\n/g) || []).length;
  ltab = ltab.replace(/(AcDbSymbolTable\n 70\n)\d+/, `$1${count}`);
  dxf = dxf.slice(0, li) + ltab + dxf.slice(le);

  const ent = '  0\nSECTION\n  2\nENTITIES\n';
  dxf = dxf.replace(ent, ent + out.join('\n') + '\n');
  dxf = dxf.replace(/(\$HANDSEED\n\s*5\n)[0-9A-Fa-f]+/, `$1${h.toString(16).toUpperCase()}`);
  return dxf;
}
if (typeof module !== 'undefined') module.exports = { buildDXF };
