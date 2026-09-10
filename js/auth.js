/* ============================================================
 * auth.js - 簡易帳號密碼保護
 *
 * 這是純前端的簡易保護（避免客戶、路人不小心進入後台看到案件
 * 資料），不是真正防止惡意攻擊的機制（畢竟是純靜態網站，任何人
 * 打開瀏覽器原始碼都能看到帳密）。如果之後有更高安全性需求，
 * 建議改接有後端驗證的登入系統。
 *
 * 用法：在每個要保護的 html 檔案的 <head> 最前面加入
 *   <script src="js/auth.js"></script>
 * 這支腳本會在頁面內容顯示前檢查是否已登入，未登入就先隱藏畫面
 * 並顯示登入框，輸入正確帳密後才會顯示原本的內容。
 * ============================================================ */
(function () {
  var AUTH_ACCOUNT = 'NL123456';
  var AUTH_PASSWORD = 'NL654321';
  var AUTH_KEY = 'nlAuthOk';

  function isLoggedIn() {
    try { return localStorage.getItem(AUTH_KEY) === '1'; } catch (e) { return false; }
  }

  function setLoggedIn() {
    try { localStorage.setItem(AUTH_KEY, '1'); } catch (e) {}
  }

  function logout() {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    window.location.reload();
  }
  window.nlLogout = logout;

  if (isLoggedIn()) return;

  // 先把整個頁面隱藏起來，避免登入框出現前畫面內容閃一下
  document.documentElement.style.visibility = 'hidden';

  function showLoginOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#0f172a;'
      + 'display:flex;align-items:center;justify-content:center;padding:20px;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Heiti TC","Microsoft JhengHei",sans-serif;';
    overlay.innerHTML =
      '<div style="width:100%;max-width:340px;background:#ffffff;border-radius:14px;padding:28px 24px;box-shadow:0 10px 40px rgba(0,0,0,0.35);">'
      + '<div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:4px;">NINTH LAB</div>'
      + '<div style="font-size:13px;color:#666;margin-bottom:20px;">請輸入帳號密碼以繼續</div>'
      + '<div style="margin-bottom:12px;">'
      + '<label style="display:block;font-size:12.5px;color:#555;margin-bottom:4px;">帳號</label>'
      + '<input id="authAccountInput" type="text" autocomplete="username" '
      + 'style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px;" />'
      + '</div>'
      + '<div style="margin-bottom:8px;">'
      + '<label style="display:block;font-size:12.5px;color:#555;margin-bottom:4px;">密碼</label>'
      + '<input id="authPasswordInput" type="password" autocomplete="current-password" '
      + 'style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px;" />'
      + '</div>'
      + '<div id="authError" style="color:#dc2626;font-size:12.5px;min-height:18px;margin-bottom:6px;"></div>'
      + '<button id="authSubmitBtn" type="button" '
      + 'style="width:100%;padding:12px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;font-weight:700;">登入</button>'
      + '</div>';
    document.documentElement.appendChild(overlay);
    document.documentElement.style.visibility = 'visible';

    var accEl = overlay.querySelector('#authAccountInput');
    var pwEl = overlay.querySelector('#authPasswordInput');
    var errEl = overlay.querySelector('#authError');
    var btnEl = overlay.querySelector('#authSubmitBtn');

    function attempt() {
      var acc = accEl.value.trim();
      var pw = pwEl.value;
      if (acc === AUTH_ACCOUNT && pw === AUTH_PASSWORD) {
        setLoggedIn();
        overlay.remove();
      } else {
        errEl.textContent = '帳號或密碼錯誤，請再試一次。';
        pwEl.value = '';
        pwEl.focus();
      }
    }
    btnEl.addEventListener('click', attempt);
    [accEl, pwEl].forEach(function (el) {
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
    });
    setTimeout(function () { accEl.focus(); }, 50);
  }

  document.addEventListener('DOMContentLoaded', showLoginOverlay);
})();
