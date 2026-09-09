/* ============================================================
 * utils.js - 共用小工具
 * ============================================================ */

function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function pad6(n) { return String(n).padStart(CASE_ID_PAD_LENGTH, '0'); }

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function formatDateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

const STATUS_LABELS = {
  draft: '草稿',
  in_progress: '維修中',
  pending_confirmation: '待客戶確認',
  completed: '已完成',
};

const STATUS_CLASSES = {
  draft: 'status-draft',
  in_progress: 'status-progress',
  pending_confirmation: 'status-pending',
  completed: 'status-done',
};

function statusLabel(status) { return STATUS_LABELS[status] || status; }
function statusClass(status) { return STATUS_CLASSES[status] || ''; }

/* ---------------- Toast 提示（取代生硬的 alert，但關鍵錯誤仍用明顯樣式） ---------------- */
let _toastTimer = null;
function showToast(message, type) {
  let el = qs('#globalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'toast show ' + (type === 'error' ? 'toast-error' : (type === 'success' ? 'toast-success' : ''));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function showBlockingError(message) {
  // 用於必須讓技師確實注意到的錯誤（例如送出失敗、編號衝突）
  showToast(message, 'error');
  const bar = qs('#formErrorBar');
  if (bar) {
    bar.textContent = message;
    bar.classList.add('show');
    setTimeout(() => bar.classList.remove('show'), 4500);
  }
}

/* ---------------- 圖片壓縮：拍照/選圖後先縮小尺寸與品質再存入 IndexedDB ---------------- */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compressImageFile(file) {
  const rawDataUrl = await fileToDataURL(file);
  try {
    const img = await loadImage(rawDataUrl);
    let { width, height } = img;
    const maxW = PHOTO_MAX_WIDTH, maxH = PHOTO_MAX_HEIGHT;
    if (width > maxW || height > maxH) {
      const ratio = Math.min(maxW / width, maxH / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
  } catch (e) {
    // 壓縮失敗（例如非圖片格式），退回原始 dataURL
    return rawDataUrl;
  }
}

/* ---------------- Debounce（草稿自動保存用） ---------------- */
function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ---------------- 簡易 Modal 確認框（取代 confirm()，手機體驗更好） ---------------- */
function confirmDialog(message, okText, cancelText) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <p class="modal-message"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary modal-cancel"></button>
          <button type="button" class="btn btn-danger modal-ok"></button>
        </div>
      </div>`;
    qs('.modal-message', overlay).textContent = message;
    qs('.modal-cancel', overlay).textContent = cancelText || '取消';
    qs('.modal-ok', overlay).textContent = okText || '確定';
    document.body.appendChild(overlay);
    qs('.modal-cancel', overlay).addEventListener('click', () => { overlay.remove(); resolve(false); });
    qs('.modal-ok', overlay).addEventListener('click', () => { overlay.remove(); resolve(true); });
  });
}

/* ---------------- 觸控裝置判斷（決定是否優先呼叫相機） ---------------- */
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/* ---------------- 通用 querystring 讀取 ---------------- */
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ---------------- 路徑取值／設值（供表單資料綁定使用） ---------------- */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}

/* ---------------- PDF 下載 ---------------- */
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

function openBlobInNewTab(blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ----------------------------------------------------------
 * LINE 傳送流程（純靜態網站可以做到的最佳方案）
 * 重要：不會、也不能自動把 PDF 塞進 LINE 聊天輸入框並自動傳送。
 * 正確流程：下載 / 保存 PDF → 開啟 LINE 聊天室 → 技師手動附加並傳送。
 * ---------------------------------------------------------- */
function performLineHandoff(pdfResult) {
  try {
    triggerBlobDownload(pdfResult.blob, pdfResult.filename);
  } catch (e) {
    console.error(e);
  }
  if (!LINE_CHAT_URL || LINE_CHAT_URL === 'YOUR_LINE_CHAT_URL') {
    showBlockingError('尚未設定 LINE 聊天室連結，請在 js/config.js 設定 LINE_CHAT_URL。');
    return;
  }
  window.open(LINE_CHAT_URL, '_blank');
  showToast('LINE 聊天室已開啟，請手動傳送 PDF。', 'success');
}
