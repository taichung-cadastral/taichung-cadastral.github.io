# 把 data/ 底下的 .json 轉成網頁載入用的 .js（cadData("路徑", 內容);）
# sections.json 會拆成兩個檔：
#   sections.js        地段清單（段名、段代碼、行政區、筆數、範圍），開網頁就載入
#   sections-shape.js  地段邊界，開啟地籍圖層時才載入
# 其餘 lots/*.json、zones/*.json、zone-attrs.json 直接包成 .js
# 用法：python tojs.py <網站資料夾>
import os, sys, glob, json
root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
data = os.path.join(root, 'data')

def write_js(rel, obj_text):
    with open(os.path.join(root, rel[:-5] + '.js'), 'w', encoding='utf-8') as o:
        o.write(f'cadData("{rel}",{obj_text});\n')

n = 0
sj = os.path.join(data, 'sections.json')
if os.path.exists(sj):
    idx = json.load(open(sj, encoding='utf-8'))
    shapes = {s['k']: s.pop('r', []) for s in idx['sections']}
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    write_js('data/sections.json', dump(idx)); write_js('data/sections-shape.json', dump(shapes)); n += 2
files = glob.glob(os.path.join(data, 'lots', '*.json')) + glob.glob(os.path.join(data, 'zones', '*.json'))
za = os.path.join(data, 'zone-attrs.json')
if os.path.exists(za): files.append(za)
for f in sorted(files):
    write_js(os.path.relpath(f, root).replace(os.sep, '/'), open(f, encoding='utf-8').read().strip()); n += 1
print(n, 'files written')
