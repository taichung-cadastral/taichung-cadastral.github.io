# 產生網站資料：每個地段一個 JSON（TWD97 坐標，mm 整數差分編碼）+ 地段索引
import shapefile, json, os, sys, collections
from shapely.geometry import Polygon, shape as gshape
from shapely import STRtree, force_2d, make_valid
ZSRC = os.path.expanduser('~/work/zone/01-SHP/114期末_U0002_1210')
ZATTR = os.path.expanduser('~/work/web_z/zone-attrs.json')
ZD = {'中區','東區','南區','西區','北區','西屯區','南屯區','北屯區','太平區','潭子區'}
SRC = os.path.expanduser('~/work/src/Land11505/')
OUT = sys.argv[1]; dists = set(sys.argv[2:])
os.makedirs(OUT + '/lots', exist_ok=True)
idx = json.load(open(os.path.expanduser('~/work/idx.json')))

def rings(shp):
    pts = shp.points; parts = list(shp.parts) + [len(pts)]
    for a, b in zip(parts[:-1], parts[1:]):
        r = pts[a:b]
        if len(r) > 1 and r[0] == r[-1]: r = r[:-1]
        if len(r) >= 3: yield r

def enc(ring, ox, oy):
    out = []; px = py = 0
    for x, y in ring:
        ix = round((x - ox) * 1000); iy = round((y - oy) * 1000)
        out += [ix - px, iy - py]; px, py = ix, iy
    return out

r = shapefile.Reader(SRC + 'Land11505', encoding='cp950')
fn = [f[0] for f in r.fields[1:]]
F = {k: fn.index(k) for k in ['UNIT','KCNT','AA48','AA49','AA10','AA46','TWD97E','TWD97N','AA11','AA12']}

# 都市計畫分區（屬性索引需與 zone-attrs.json 一致）
attrs = json.load(open(ZATTR, encoding='utf-8'))['attrs']
aidx = {tuple(a[:6]): i for i, a in enumerate(attrs)}
zr = shapefile.Reader(ZSRC, encoding='utf-8', encodingErrors='replace')
zgeom, zaid = [], []
for sr in zr.iterShapeRecords():
    rec = sr.record
    if rec['U2B'] not in ZD: continue
    g = make_valid(force_2d(gshape(sr.shape.__geo_interface__)))
    zgeom.append(g); zaid.append(aidx[(rec['U2C'].strip(), rec['U2E'].strip(), rec['U2H'].strip(), rec['U2I'].strip(), rec['U2J'].strip(), rec['U2K'].strip())])
ztree = STRtree(zgeom)

def zoning(rec, shp):
    a11 = rec[F['AA11']].strip(); a12 = rec[F['AA12']].strip()
    if a11 not in ('', '-'):
        return f'{a11}|{a12}'                       # 非都市土地：使用分區|使用地類別
    try:
        g = make_valid(gshape(shp.__geo_interface__))
    except Exception:
        return []
    A = g.area
    if A <= 0: return []
    acc = collections.Counter()
    for i in ztree.query(g):
        inter = g.intersection(zgeom[i]).area
        if inter > 0: acc[zaid[i]] += inter
    out = [[aid, round(v / A * 100)] for aid, v in acc.most_common() if v / A >= 0.01]
    rest = 100 - sum(p for _, p in out)
    if rest >= 3: out.append([-1, rest])           # 未劃分區（多為計畫道路）
    return out
groups = collections.defaultdict(list)
for d in sorted(dists):
    for n in idx[d]:
        sr = r.shapeRecord(n); rec = sr.record
        groups[rec[F['UNIT']] + rec[F['AA48']]].append((rec, sr.shape))

# 地段索引（邊界來自地段圖，簡化 1m）
sr_ = shapefile.Reader(SRC + 'Sect11505', encoding='cp950')
sf = [f[0] for f in sr_.fields[1:]]
sections = []
for s in sr_.iterShapeRecords():
    rec = s.record; key = rec[sf.index('UNIT')] + rec[sf.index('AA48')]
    if key not in groups: continue
    rs = [[[round(x, 1), round(y, 1)] for x, y in Polygon(g).simplify(1.0).exterior.coords] for g in rings(s.shape)]
    sections.append({'k': key, 'n': rec[sf.index('KCNT')], 'c': rec[sf.index('AA48')], 'd': rec[sf.index('AA46')], 'r': rs})

total = 0
for key, items in groups.items():
    xs = [p[0] for _, s in items for p in s.points]; ys = [p[1] for _, s in items for p in s.points]
    ox, oy = int(min(xs)), int(min(ys))
    lots = []
    for rec, shp in items:
        lx, ly = rec[F['TWD97E']], rec[F['TWD97N']]
        lots.append([rec[F['AA49']], rec[F['AA10']], round((lx-ox)*1000), round((ly-oy)*1000),
                     [enc(g, ox, oy) for g in rings(shp)], zoning(rec, shp)])
    lots.sort(key=lambda t: t[0])
    name = items[0][0][F['KCNT']]
    js = json.dumps({'k': key, 'n': name, 'o': [ox, oy], 'lots': lots}, ensure_ascii=False, separators=(',', ':'))
    open(f'{OUT}/lots/{key}.json', 'w', encoding='utf-8').write(js); total += len(js.encode())
    sec = next((s for s in sections if s['k'] == key), None)
    if sec is None:
        sections.append({'k': key, 'n': name, 'c': rec[F['AA48']], 'd': rec[F['AA46']], 'r': []}); sec = sections[-1]
    sec['cnt'] = len(lots); sec['b'] = [ox, oy, int(max(xs))+1, int(max(ys))+1]
sections.sort(key=lambda s: s['n'])
json.dump({'version': '1150507', 'sections': sections}, open(f'{OUT}/sections.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('sections', len(sections), 'lots', sum(len(v) for v in groups.values()), 'bytes', total)
