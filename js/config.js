/* ============================================================
 * config.js
 * 集中設定檔（全站唯一設定入口）
 *
 * 重要：LINE 聊天室連結只需要修改這裡的 LINE_CHAT_URL 一個地方，
 * 其他程式碼都是讀取這個常數，不會在別處重複寫死網址。
 * ============================================================ */

// 請將這裡換成實際的 LINE 聊天室 / 社群 / 個人的連結
// 例如： "https://line.me/R/ti/p/@your_line_id"
// 或群組邀請連結： "https://line.me/R/ti/g/xxxxxxxxxx"
const LINE_CHAT_URL = "YOUR_LINE_CHAT_URL";

// 品牌顯示名稱（顯示於頁首與 PDF 報告）
const BRAND_NAME = "NINTH LAB";
const BRAND_SUBTITLE = "手機維修｜客戶快速檢查確認表";

// 案件編號格式設定
const CASE_ID_PREFIX = "REP-";
const CASE_ID_PAD_LENGTH = 6; // REP-000001

// 照片壓縮設定（避免 IndexedDB 佔用空間過大、加快載入速度）
const PHOTO_MAX_WIDTH = 1440;
const PHOTO_MAX_HEIGHT = 1440;
const PHOTO_JPEG_QUALITY = 0.72;

// PDF 檔名後綴
const PDF_FILENAME_SUFFIX = "_手機維修檢查表.pdf";

/* ------------------------------------------------------------
 * 未來後端擴充位置
 * ------------------------------------------------------------
 * 目前所有資料存取都集中在 js/db.js 內的下列函式：
 *   allocateNextRepairNumber()
 *   saveRepair() / updateRepair()
 *   getRepair() / getAllRepairs()
 *   deleteRepair()
 *   exportRepairs() / importRepairs()
 * 未來若要改接 Firebase / Supabase / 自建 API，
 * 只需要把 js/db.js 內這些函式的「內部實作」換成 fetch()/SDK 呼叫，
 * 呼叫端（wizard.js / records.js / detail.js / home.js）完全不用修改。
 * ------------------------------------------------------------ */
