# 都市計畫分區：產生屬性表 zone-attrs.json 與各行政區分區圖層 zones/<區代碼>.json
import shapefile, json, os, sys, re
from shapely.geometry import Polygon
SRC = os.path.expanduser('~/work/zone/01-SHP/114期末_U0002_1210')
OUT = sys.argv[1]
os.makedirs(OUT + '/zones', exist_ok=True)
DIST = {'中區':'01','東區':'02','南區':'03','西區':'04','北區':'05','西屯區':'06','南屯區':'07','北屯區':'08','太平區':'27'}

def cat(name):
    n = re.split(r'兼|\(', name)[0]
    for k, pat in [('住', '住宅'), ('商', '商業|經貿|新市政'), ('工', '工業'), ('農', '農業區'),
                   ('綠', '公園|兒童|綠地|綠帶|廣場|體育|遊憩|風景|運動場'), ('水', '河|排水|溝渠|滯洪|水道'),
                   ('交', '道路|鐵路|高速|捷運|園道|停車|車站|交通|航空|人行'), ('專', '專用區|文化商業|創新研發'),
                   ('存', '保存區')]:
        if re.search(pat, n): return k
    return '公'

r = shapefile.Reader(SRC, encoding='utf-8', encodingErrors='replace')
attrs, aidx, per = [], {}, {d: [] for d in DIST.values()}
for sr in r.iterShapeRecords():
    rec = sr.record; d = DIST.get(rec['U2B'])
    if not d: continue
    key = (rec['U2C'].strip(), rec['U2E'].strip(), rec['U2H'].strip(), rec['U2I'].strip(), rec['U2J'].strip(), rec['U2K'].strip())
    if key not in aidx:
        aidx[key] = len(attrs); attrs.append(list(key) + [cat(key[0])])
    pts = sr.shape.points; parts = list(sr.shape.parts) + [len(pts)]
    rings = [pts[a:b] for a, b in zip(parts[:-1], parts[1:]) if b - a >= 4]
    per[d].append((aidx[key], rings, rec['U2A']))
# attrs: [使用分區, 簡稱, 建蔽率, 容積率, 上限容積, 都市計畫區, 類別]
json.dump({'fields': ['name', 'short', 'bcr', 'far', 'farMax', 'plan', 'cat'], 'attrs': attrs},
          open(OUT + '/zone-attrs.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

def enc(ring, ox, oy):      # 公寸（0.1 m）整數差分
    out, px, py = [], 0, 0
    for x, y in ring:
        ix, iy = round((x - ox) * 10), round((y - oy) * 10)
        out += [ix - px, iy - py]; px, py = ix, iy
    return out

for d, items in per.items():
    xs = [p[0] for _, rs, _ in items for r_ in rs for p in r_]; ys = [p[1] for _, rs, _ in items for p in [q for r_ in rs for q in r_]]
    ox, oy = int(min(xs)), int(min(ys))
    z = []
    for aid, rs, _ in items:
        simp = []
        for ring in rs:
            g = Polygon(ring).simplify(0.2)
            if g.is_empty or g.geom_type != 'Polygon': g = Polygon(ring)
            simp.append(enc(list(g.exterior.coords)[:-1], ox, oy))
        z.append([aid, simp])
    json.dump({'d': d, 'o': [ox, oy], 'b': [ox, oy, int(max(xs)) + 1, int(max(ys)) + 1], 'z': z},
              open(f'{OUT}/zones/{d}.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('attrs', len(attrs))
for d in per: print(d, len(per[d]), os.path.getsize(f'{OUT}/zones/{d}.json') // 1024, 'KB')
