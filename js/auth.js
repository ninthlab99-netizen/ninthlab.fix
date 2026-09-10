/* ============================================================
 * auth.js - 登入驗證閘門（改為串接 Firebase Authentication）
 *
 * 使用者只需要輸入固定帳號「NL123456」與密碼，實際登入是透過
 * Firebase Authentication 的 Email/Password 登入方式完成
 * （內部會把 NL123456 對應成一個內部信箱 nl123456@ninthlab.local，
 *  使用者完全不會看到這個信箱）。
 *
 * 這一層是「真正的伺服器端驗證」：
 *   - 密碼是否正確由 Firebase 後端檢查，不是前端字串比對。
 *   - 所有 Firestore 資料的讀寫，也都要求「已登入這個帳號」才允許
 *     （見 Firestore 安全性規則），所以就算有人略過這個畫面，
 *     直接呼叫資料庫也一樣會被拒絕。
 *
 * 登入狀態由 Firebase 自動保存在瀏覽器中（重新整理、關閉分頁後
 * 重新打開都會維持登入），不需要另外用 localStorage 記錄。
 * ============================================================ */

(function () {
  var AUTH_ACCOUNT = 'NL123456';
  var AUTH_EMAIL = 'nl123456@ninthlab.local';

  function logout() {
    fsAuth.signOut().catch(function (e) { console.error(e); }).then(function () {
      window.location.reload();
    });
  }
  window.nlLogout = logout;

  // 先隱藏整個頁面，等確認登入狀態後才顯示，避免畫面閃一下又跳出登入框。
  document.documentElement.style.visibility = 'hidden';

  function showLoginOverlay() {
    if (document.getElementById('authOverlay')) return; // 避免重複建立
    var overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#0f172a;' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Heiti TC",' +
      '"Microsoft JhengHei","Noto Sans TC","Segoe UI",Roboto,sans-serif;';

    overlay.innerHTML =
      '<div style="width:100%;max-width:340px;background:#111827;border:1px solid #1f2937;' +
      'border-radius:16px;padding:28px 24px;box-shadow:0 10px 30px rgba(0,0,0,.4);">' +
        '<div style="text-align:center;margin-bottom:22px;">' +
          '<div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:.5px;">NINTH LAB</div>' +
          '<div style="font-size:13px;color:#94a3b8;margin-top:4px;">手機維修｜客戶快速檢查確認表</div>' +
        '</div>' +
        '<div style="margin-bottom:14px;">' +
          '<label style="display:block;font-size:13px;color:#cbd5e1;margin-bottom:6px;">帳號</label>' +
          '<input id="authAccountInput" type="text" autocomplete="username" placeholder="請輸入帳號" ' +
            'style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #334155;' +
            'background:#0b1220;color:#fff;font-size:15px;outline:none;" />' +
        '</div>' +
        '<div style="margin-bottom:8px;">' +
          '<label style="display:block;font-size:13px;color:#cbd5e1;margin-bottom:6px;">密碼</label>' +
          '<input id="authPasswordInput" type="password" autocomplete="current-password" placeholder="請輸入密碼" ' +
            'style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #334155;' +
            'background:#0b1220;color:#fff;font-size:15px;outline:none;" />' +
        '</div>' +
        '<div id="authError" style="min-height:18px;color:#f87171;font-size:12.5px;margin:6px 2px 12px;"></div>' +
        '<button id="authSubmitBtn" type="button" style="width:100%;padding:12px;border:none;border-radius:10px;' +
          'background:#2563eb;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">登入</button>' +
      '</div>';

    document.documentElement.appendChild(overlay);
    document.documentElement.style.visibility = 'visible';

    var accEl = overlay.querySelector('#authAccountInput');
    var pwEl = overlay.querySelector('#authPasswordInput');
    var errEl = overlay.querySelector('#authError');
    var btnEl = overlay.querySelector('#authSubmitBtn');

    function setBusy(busy) {
      btnEl.disabled = busy;
      btnEl.style.opacity = busy ? '0.6' : '1';
      btnEl.textContent = busy ? '登入中…' : '登入';
    }

    function attempt() {
      var acc = (accEl.value || '').trim();
      var pw = pwEl.value || '';
      if (!acc || !pw) {
        errEl.textContent = '請輸入帳號與密碼。';
        return;
      }
      if (acc.toUpperCase() !== AUTH_ACCOUNT) {
        errEl.textContent = '帳號或密碼錯誤，請再試一次。';
        pwEl.value = '';
        pwEl.focus();
        return;
      }
      errEl.textContent = '';
      setBusy(true);
      fsAuth.signInWithEmailAndPassword(AUTH_EMAIL, pw)
        .then(function () {
          overlay.remove();
        })
        .catch(function (err) {
          console.error(err);
          if (err && err.code === 'auth/network-request-failed') {
            errEl.textContent = '無法連線，請確認網路連線後再試一次。';
          } else {
            errEl.textContent = '帳號或密碼錯誤，請再試一次。';
          }
          pwEl.value = '';
          pwEl.focus();
        })
        .finally(function () { setBusy(false); });
    }

    btnEl.addEventListener('click', attempt);
    [accEl, pwEl].forEach(function (el) {
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
    });
    setTimeout(function () { accEl.focus(); }, 50);
  }

  fsAuth.onAuthStateChanged(function (user) {
    var isCorrectUser = !!(user && user.email === AUTH_EMAIL);
    if (isCorrectUser) {
      var overlay = document.getElementById('authOverlay');
      if (overlay) overlay.remove();
      document.documentElement.style.visibility = 'visible';
    } else {
      if (user) {
        // 理論上不會發生（只有一組帳密），保險起見登出重新導回登入畫面。
        fsAuth.signOut();
      }
      showLoginOverlay();
    }
  }, function (err) {
    console.error('登入狀態檢查失敗：', err);
    showLoginOverlay();
  });
})();
