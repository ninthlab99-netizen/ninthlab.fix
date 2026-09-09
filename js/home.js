/* ============================================================
 * home.js - 首頁邏輯
 * ============================================================ */

(async function initHome() {
  qsa('#brandLabel, #brandLabel2').forEach((el) => { el.textContent = BRAND_NAME; });

  try {
    await reconcileCounter();
    const all = await getAllRepairs();
    const unfinished = all.filter((r) => r.status !== 'completed');

    renderDraftBanner(unfinished);
    renderRecentList(all.slice(0, 6));
  } catch (e) {
    console.error(e);
    showToast('資料載入失敗：' + e.message, 'error');
  }

  qs('#btnNewCase').addEventListener('click', onCreateNewCase);
  qs('#btnRecords').addEventListener('click', () => { window.location.href = 'records.html'; });

  function renderDraftBanner(unfinished) {
    const banner = qs('#draftBanner');
    const continueBtn = qs('#btnContinueDraft');
    if (unfinished.length > 0) {
      banner.style.display = '';
      qs('#draftBannerText').textContent = `目前有 ${unfinished.length} 筆未完成案件`;
      qs('#draftBannerBtn').onclick = () => { window.location.href = 'records.html?status=unfinished'; };
      continueBtn.style.display = '';
      continueBtn.onclick = () => {
        // 開啟最近更新的一筆未完成案件
        const latest = unfinished.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
        window.location.href = `wizard.html?case=${encodeURIComponent(latest.caseId)}`;
      };
    } else {
      banner.style.display = 'none';
      continueBtn.style.display = 'none';
    }
  }

  function renderRecentList(list) {
    const container = qs('#recentList');
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🗂️</div>尚無任何案件，點擊上方「＋ 建立新案件」開始使用。</div>';
      return;
    }
    list.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'case-item';
      div.innerHTML = `
        <div class="case-item-main">
          <div class="case-item-id">${r.caseId}</div>
          <div class="case-item-meta">${(r.basic.customerName || '未填客戶')} · ${(r.basic.phoneModel || '未填型號')} · ${formatDateOnly(r.updatedAt)}</div>
        </div>
        <span class="status-badge ${statusClass(r.status)}">${statusLabel(r.status)}</span>
        <span class="case-item-arrow">›</span>`;
      div.addEventListener('click', () => {
        if (r.status === 'completed') {
          window.location.href = `detail.html?case=${encodeURIComponent(r.caseId)}`;
        } else {
          window.location.href = `wizard.html?case=${encodeURIComponent(r.caseId)}`;
        }
      });
      container.appendChild(div);
    });
  }

  async function onCreateNewCase() {
    const btn = qs('#btnNewCase');
    btn.disabled = true;
    try {
      const lastTech = localStorage.getItem('repairShop_lastTechnician') || '';
      const record = await allocateNextRepairNumber({ technician: lastTech });
      window.location.href = `wizard.html?case=${encodeURIComponent(record.caseId)}`;
    } catch (e) {
      console.error(e);
      showToast('建立案件失敗：' + e.message, 'error');
      btn.disabled = false;
    }
  }
})();
