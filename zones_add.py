# 追加行政區的都市計畫分區：既有 zone-attrs 編號不變，新分區接在表尾
# 用法：python zones_add.py <web_z 資料夾> 潭子區=17 [其他區=代碼 ...]
import shapefile, json, os, sys, re
from shapely.geometry import Polygon
SRC = os.path.expanduser('~/work/zone/01-SHP/114期末_U0002_1210')
OUT = sys.argv[1]
ADD = dict(a.split('=') for a in sys.argv[2:])

def cat(name):
    n = re.split(r'兼|\(', name)[0]
    for k, pat in [('住', '住宅'), ('商', '商業|經貿|新市政'), ('工', '工業'), ('農', '農業區'),
                   ('綠', '公園|兒童|綠地|綠帶|廣場|體育|遊憩|風景|運動場'), ('水', '河|排水|溝渠|滯洪|水道'),
                   ('交', '道路|鐵路|高速|捷運|園道|停車|車站|交通|航空|人行'), ('專', '專用區|文化商業|創新研發'),
                   ('存', '保存區')]:
        if re.search(pat, n): return k
    return '公'

j = json.load(open(OUT + '/zone-attrs.json', encoding='utf-8'))
attrs = j['attrs']; before = len(attrs)
aidx = {tuple(a[:6]): i for i, a in enumerate(attrs)}
r = shapefile.Reader(SRC, encoding='utf-8', encodingErrors='replace')
per = {d: [] for d in ADD.values()}
for sr in r.iterShapeRecords():
    rec = sr.record; d = ADD.get(rec['U2B'])
    if not d: continue
    key = (rec['U2C'].strip(), rec['U2E'].strip(), rec['U2H'].strip(), rec['U2I'].strip(), rec['U2J'].strip(), rec['U2K'].strip())
    if key not in aidx:
        aidx[key] = len(attrs); attrs.append(list(key) + [cat(key[0])])
    pts = sr.shape.points; parts = list(sr.shape.parts) + [len(pts)]
    per[d].append((aidx[key], [pts[a:b] for a, b in zip(parts[:-1], parts[1:]) if b - a >= 4]))
json.dump(j, open(OUT + '/zone-attrs.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

def enc(ring, ox, oy):
    out, px, py = [], 0, 0
    for x, y in ring:
        ix, iy = round((x - ox) * 10), round((y - oy) * 10)
        out += [ix - px, iy - py]; px, py = ix, iy
    return out
for d, items in per.items():
    pts = [p for _, rs in items for r_ in rs for p in r_]
    ox, oy = int(min(p[0] for p in pts)), int(min(p[1] for p in pts))
    z = []
    for aid, rs in items:
        simp = []
        for ring in rs:
            g = Polygon(ring).simplify(0.2)
            if g.is_empty or g.geom_type != 'Polygon': g = Polygon(ring)
            simp.append(enc(list(g.exterior.coords)[:-1], ox, oy))
        z.append([aid, simp])
    json.dump({'d': d, 'o': [ox, oy], 'b': [ox, oy, int(max(p[0] for p in pts)) + 1, int(max(p[1] for p in pts)) + 1], 'z': z},
              open(f'{OUT}/zones/{d}.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(d, 'zones', len(items), os.path.getsize(f'{OUT}/zones/{d}.json') // 1024, 'KB')
print('attrs', before, '->', len(attrs))
