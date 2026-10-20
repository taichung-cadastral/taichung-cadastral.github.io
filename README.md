# 臺中市地籍圖 DXF 下載

以地號查詢或在地圖上點選宗地，在瀏覽器內直接產生 DXF。直接雙擊 `index.html` 就能使用，也可以整個資料夾放上 GitHub Pages 或 Cloudflare。

- 範圍：舊臺中市 8 區（中、東、南、西、北、西屯、南屯、北屯）＋潭子區＋太平區，509 個地段、540,371 筆宗地（更新紀錄見 updates.html）
- 坐標：TWD97 TM2（EPSG:3826），單位公尺，與原始 SHP 相同（取到公釐）
- DXF：AutoCAD 2010（AC1024），文字為新細明體（mingliu.ttc）。每筆宗地依使用分區填色：都市計畫分區以 polygon-clipping 裁切到宗地範圍（跨分區的宗地會切成多塊），非都市土地依地籍登記的使用分區整筆上色；實心 HATCH、網頁同色、50% 透明。地號下方標分區簡稱。宗地右側附「地籍清單」表（地段、地號、面積、土地使用分區、建蔽率、容積率、合計；非都市土地建蔽率／容積率依非都市土地使用管制規則第 9 條上限，其他使用地以「—」表示）。只輸出有用到的圖層（宗地界、地號、段名、分區_名稱、分區_<類別>、地籍清單）
- 選取方式：單筆點選、地號查詢、框選（碰到方框就算）、上傳 KML／KMZ（宗地有 5% 以上在範圍內；只讀取 Polygon 與頭尾相接的 LineString，WGS84 經緯度轉 TWD97）
- DXF 開啟時視窗置中在地籍（設定 VPORT *Active 的中心與高度、$EXTMIN／$EXTMAX）
- 另可下載選取清單 CSV（行政區、地段、段代碼、地號、登記面積 m²／坪、地號標示點坐標）
- 地籍圖層預設關閉，勾選「開啟地籍圖圖層」才載入地段邊界與宗地；用地號查詢時會自動開啟
- 使用分區：
  - 都市計畫土地：宗地與〈臺中市都市計畫圖GIS（114年_最新版）〉（臺中市政府都市發展局，dataset 126736）套疊，算出各分區所占比例，附建蔽率、容積率、都市計畫區；分區圖未涵蓋的部分標為「未劃分區（多為計畫道路）」
  - 非都市土地：取地籍資料 AA11（使用分區）、AA12（使用地類別），代碼依內政部地政司〈非都市土地使用分區及使用地類別代碼〉（dataset 25113）
  - 「開啟使用分區圖層」可在地圖上依類別著色（放大到第 13 級以上依畫面載入），附圖例
  - 分區為套疊推估，僅供參考，正式分區以都市發展局核發之分區證明為準

## 使用規則與防護

| 層級 | 規則 | 部署位置 |
|---|---|---|
| 網頁 | 單筆點選／地號查詢最多 10 筆、框選最多 50 筆、KML／KMZ 圈選最多 100 筆；只能同一行政區 | 任何主機 |
| 網頁 | 2 分鐘內上傳 KML／KMZ 超過 5 次、或 3 秒內連續上傳 → 冷卻 2 分鐘；框選與地號查詢合併計次 | 任何主機 |
| 網頁 | 2 分鐘內下載超過 5 次、或 3 秒內連續下載 → 冷卻 2 分鐘 | 任何主機 |
| 網頁 | 1 分鐘內查詢超過 20 次 → 冷卻 2 分鐘 | 任何主機 |
| 網頁 | 2 分鐘內載入超過 60 個地段檔 → 冷卻 2 分鐘 | 任何主機 |
| 網頁 | 偵測到自動化瀏覽器（Selenium／Puppeteer 等）→ 不提供下載 | 任何主機 |
| 伺服器 | curl、wget、python 等程式化請求 → 403 | Cloudflare |
| 伺服器 | 非本站網頁發出的資料請求 → 403 | Cloudflare |
| 伺服器 | 同一 IP 每 60 秒超過 60 次資料請求 → 429，封鎖 2 分鐘 | Cloudflare（2 分鐘封鎖需自訂網域） |

網頁層在使用者瀏覽器執行，擋一般使用與簡單的自動點擊；會寫程式的人可以繞過，所以真正的流量防護靠伺服器層。數值可在 `app.js` 的 `RULES`、`MAX_SEL` 與 `wrangler.jsonc` 調整。

## 資料夾

```
index.html  style.css  app.js        網頁
dxf.js  dxf-template.js              瀏覽器端 DXF 產生器（範本由 ezdxf 產生）
lib/                                 Leaflet 1.9.4、proj4 2.11.0、polygon-clipping 0.15.7、fflate 0.8.2（KMZ 解壓縮，上傳 KMZ 時才載入）
data/sections.js                     地段清單（段名、段代碼、行政區、筆數、範圍），開網頁就載入（46 KB）
data/sections-shape.js               地段邊界，開啟地籍圖層才載入（1.4 MB）
data/zone-attrs.js                   都市計畫分區屬性表（分區、簡稱、建蔽率、容積率、上限容積、計畫區、類別）
data/zones/<區代碼>.js                各行政區都市計畫分區圖層（坐標 0.1 m 整數差分）
data/lots/<地所代碼+段代碼>.js         每個地段一個檔，宗地坐標以公釐整數差分編碼
cloudflare/worker.js                 伺服器端防護（只處理 /data/*）
cloudflare/test-worker.mjs           在 Node 模擬測試防護規則：node cloudflare/test-worker.mjs
wrangler.jsonc  .assetsignore        Cloudflare 部署設定
robots.txt                           請搜尋引擎不要抓 /data/
index.py  zones.py  webdata2.py  tojs.py  由地籍 SHP 與都市計畫 SHP 產生 data/
```

## 部署

### Cloudflare（建議，有伺服器端防護）

```
npm install -g wrangler        # 需要 4.36 以上
wrangler login
wrangler deploy                # 在本資料夾執行
```

部署後網址為 `https://taichung-cadastral.<帳號>.workers.dev`。要啟用「封鎖 2 分鐘」請在 Cloudflare 後台把 Worker 綁到自訂網域。

### GitHub Pages（只有網頁層防護）

推到 repository 後在 Settings → Pages 選 `main` 分支根目錄。檔案 470 多個，GitHub 網頁一次只能上傳 100 個，請用 git 或 GitHub Desktop 上傳。

資料檔是 `.js`（內容為 `cadData("路徑", {...});`），由網頁以 `<script>` 載入，因此本機雙擊開啟（file://）也能讀取。

## 容量

舊臺中市＋太平區：460 個地段檔共 65.7 MB，最大單檔 2.5 MB。開網頁只載入 46 KB 的地段清單（壓縮後 12 KB），其餘在開啟地籍圖層、放大到第 16 級以上時才依畫面範圍載入。

## 產生資料

```
pip install pyshp shapely py7zr
python index.py Land11505/Land11505 idx.json
python zones.py <輸出資料夾>                 # 都市計畫分區屬性表與分區圖層（第一次）
python zones_add.py <輸出資料夾> 潭子區=17     # 之後新增行政區：分區屬性只在表尾追加，既有編號不變
python webdata2.py <輸出資料夾> 02           # 每個行政區各跑一次（含宗地分區套疊），再合併 sections.json
python tojs.py <網站資料夾>                  # 把 data/ 的 .json 轉成網頁載入用的 .js，並拆出 sections-shape.js
```

## 資料來源與聲明

臺中市政府地政局〈臺中市數值地籍地段圖〉（政府資料開放平臺 dataset 83883），依政府資料開放授權條款第 1 版利用。圖解地籍區的圖形精度有限，本站圖資僅供規劃參考，不得作為產權證明或界址鑑定依據。底圖：內政部國土測繪中心通用電子地圖／正射影像。
