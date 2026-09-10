/* ============================================================
 * firebase-init.js - Firebase 專案初始化（雲端同步用）
 *
 * 使用 Firebase 官方「相容版」(compat) SDK，透過純 <script> 標籤載入，
 * 會建立全域 firebase 物件，不需要 npm / webpack 等打包工具，
 * 可以跟現有純 <script> 架構（config.js / utils.js / db.js...）相容，
 * 呼叫端完全不用改成 ES Module。
 *
 * 專案：ninthlab-fix（Firebase Firestore + Authentication）
 *
 * 重要：下面的 apiKey 等設定值屬於「用戶端設定」，公開寫在前端程式碼中
 * 是 Firebase 官方預期且安全的作法。真正的存取控制交由：
 *   1. Firebase Authentication（帳號登入）
 *   2. Firestore 安全性規則（只有登入的 NL123456 帳號才能讀寫）
 * 兩層把關，不是靠隱藏這組設定值。
 * ============================================================ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB6EoBRaks9B9zpUw1iAa270yXuGxgzkH0",
  authDomain: "ninthlab-fix.firebaseapp.com",
  projectId: "ninthlab-fix",
  storageBucket: "ninthlab-fix.firebasestorage.app",
  messagingSenderId: "777473800802",
  appId: "1:777473800802:web:b22c2793aabc166fc8ef3b",
};

firebase.initializeApp(FIREBASE_CONFIG);

const fsDB = firebase.firestore();
const fsAuth = firebase.auth();

/* 開啟離線持久化：斷網或訊號不好時，仍可讀取「先前已經同步過」的
 * 案件資料，連線恢復後會自動補送出離線時的變更。
 * 唯一例外：「建立新案件」需要跟伺服器要一個保證不重複的編號，
 * 一定要有網路連線才能執行（詳見 db.js 內的說明），這是為了
 * 徹底避免不同裝置同時建立案件卻拿到相同編號的問題。 */
try {
  fsDB.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn('Firestore 離線持久化未啟用：', err && err.code);
  });
} catch (e) {
  console.warn('Firestore 離線持久化初始化失敗：', e);
}
