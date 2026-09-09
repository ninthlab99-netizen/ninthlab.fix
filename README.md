# 手機維修｜客戶快速檢查確認表

純靜態網站（HTML + CSS + JavaScript + IndexedDB），供手機維修技師在現場使用：
建立案件 → 維修前檢查／拍照 → 維修內容 → 維修後檢查／拍照 → 客戶確認 → 雙方簽名 → 送出 → 產生 PDF → 開啟 LINE 手動傳送。

不需要任何後端伺服器（不需要 Node / PHP / MySQL / Firebase / Supabase），可以直接部署在
GitHub Pages、Cloudflare Pages、Netlify，或任何靜態網頁空間。

## 目錄結構

```
index.html          首頁（建立新案件 / 案件紀錄 / 繼續未完成案件）
wizard.html + js/wizard.js   12 步驟維修檢查表單（建立案件後進入）
records.html + js/records.js 案件紀錄／搜尋／篩選／匯出／匯入
detail.html + js/detail.js   案件詳細頁（唯讀／PDF／列印／繼續編輯／傳送 LINE）
css/style.css        全站設計樣式
js/config.js          ⭐ 集中設定（LINE 聊天室連結、品牌名稱）
js/db.js              IndexedDB 資料層（案件編號流水號、CRUD、匯出匯入）
js/utils.js           共用工具（格式化、圖片壓縮、PDF 下載、LINE 開啟…）
js/signature.js        手寫簽名板（滑鼠／觸控／觸控筆通用）
js/pdf.js              PDF 產生（使用 jsPDF）
```

## 部署方式（建議：GitHub Pages，與 NINTH LAB 官網相同做法）

1. 將整個資料夾內容 push 到你的 GitHub repo（例如與官網分開的 `repair-checklist` repo，或官網 repo 的子目錄）。
2. 到 repo 設定 → Pages → 選擇要發布的分支／目錄，儲存後即可取得網址。
3. 用手機瀏覽器開啟該網址即可使用；建議加入「加到主畫面」方便技師直接點圖示開啟。

也可以先在本機測試：在此資料夾內執行 `python3 -m http.server 8000`，
再用瀏覽器打開 `http://localhost:8000/index.html`。

> 注意：拍照（`<input type="file" capture>`）與大部分瀏覽器 API 一樣，
> 建議透過 **HTTPS** 網址存取（GitHub Pages 預設就是 HTTPS），
> 用 `http://` 直接開啟本機檔案在部分手機瀏覽器可能無法呼叫相機。

## 唯一需要修改的設定：LINE 聊天室連結

打開 `js/config.js`，修改這一行：

```js
const LINE_CHAT_URL = "YOUR_LINE_CHAT_URL";
```

換成你要接收 PDF 的 LINE 聊天室／個人／群組連結，例如：

```js
const LINE_CHAT_URL = "https://line.me/R/ti/p/@your_line_id";
```

全站只有這一個地方需要修改，其他程式碼都是讀取這個常數。
同一個檔案也可以修改品牌顯示名稱 `BRAND_NAME`（目前預設 `NINTH LAB`）。

## 關於 LINE 傳送（請務必理解這個限制）

因為這是純靜態網站，**技術上不可能**做到「自動把 PDF 塞進 LINE 聊天輸入框並自動按下傳送」。
這需要 LINE 官方 Bot API 搭配後端伺服器才能做到，而且那是「主動推送訊息」，
不是「把本機檔案放進使用者聊天框」，兩者是完全不同的技術，靜態網站都做不到。

目前實際做到的流程（也是目前技術上最佳、最快的方案）：

1. 技師按「📲 傳送至 LINE」
2. 系統自動下載／保存剛產生的 PDF 到手機
3. 系統開啟你在 `LINE_CHAT_URL` 設定的 LINE 聊天室（App 或 LINE Web）
4. 技師自己從剛剛的下載記錄選擇該 PDF，貼到聊天室，按下 LINE 的「傳送」

畫面上會清楚顯示「LINE 聊天室已開啟，請手動傳送 PDF」，不會出現「已自動傳送」等誤導文字。

## 資料保存在哪裡？

所有案件資料（含照片、簽名）保存在**技師目前使用的這個裝置、這個瀏覽器**的 IndexedDB 中，
不是雲端資料庫。清除瀏覽器資料、使用無痕模式、或換一台手機/換一個瀏覽器，都會看不到之前的案件。

**請養成定期備份的習慣**：進入「案件紀錄」頁面，點擊「⬇️ 匯出全部案件（JSON）」，
把匯出的 JSON 檔案存到雲端硬碟或電腦。需要還原時用「⬆️ 匯入案件」即可（會自動跳過已存在的案件編號，
並且會自動把流水號校正到匯入資料中最大的案件編號之後，絕對不會產生重複編號）。

## 案件編號規則

- 格式：`REP-000001`、`REP-000002`……永遠往上遞增，六位數字補零。
- 編號一旦產生就不會重複使用，即使案件被刪除，下一個新案件也不會用回被刪除的編號。
- 產生編號與建立案件記錄是同一個 IndexedDB transaction，瀏覽器會將同一個資料庫的
  transaction 序列化執行（即使是同一台裝置開兩個分頁同時按「建立新案件」），
  因此不會產生兩個相同編號的案件（已透過自動化測試驗證，包含「同一瀏覽器兩個分頁同時建立案件」情境）。

## 未來要接後端 API 時怎麼做？

`js/db.js` 已經把所有資料存取包成獨立函式：
`allocateNextRepairNumber()`、`saveRepair()` / `updateRepair()`、
`getRepair()` / `getAllRepairs()`、`deleteRepair()`、
`exportRepairs()` / `importRepairs()`。

未來要接 Firebase、Supabase 或自己的 API，只需要把這些函式「內部」的 IndexedDB
存取邏輯換成對應的 SDK／`fetch()` 呼叫即可，`wizard.js` / `records.js` /
`detail.js` / `home.js` 完全不需要修改，因為它們只呼叫這些函式的名稱與回傳格式。

## 這一版刻意沒有做的事

依照需求，這一版不包含：會員系統、複雜權限、聊天系統、付款系統、庫存系統、
CRM、複雜報表、不必要的動畫。核心只有：維修檢查＋照片存證＋客戶確認＋雙方簽名＋
案件管理＋PDF＋LINE 快速傳送。
