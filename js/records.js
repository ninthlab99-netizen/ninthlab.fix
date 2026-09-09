/* ============================================================
 * records.js - 案件紀錄／搜尋／篩選／匯出／匯入
 * ============================================================ */

const recordsState = { all: [], status: 'all', keyword: '' };

(async function initRecords() {
  qs('#brandLabel').textContent = BRAND_NAME;
  qs('#btnBackHome').addEventListener('click', () => { window.location.href = 'index.html'; });

  const initialStatus = getQueryParam('status');
  if (initialStatus === 'unfinished') {
    recordsState.status = 'all';
  }

  try {
    await reconcileCounter();
    recordsState.all = await getAllRepairs();
  } catch (e) {
    console.error(e);
    showToast('資料載入失敗：' + e.message, 'error');
  }

  if (initialStatus === 'unfinished') {
    recordsState.all = recordsState.all.filter((r) => r.status !== 'completed');
  }

  render();

  qs('#searchInput').addEventListener('input', debounce((e) => {
    recordsState.keyword = e.target.value;
    render();
  }, 200));

  qsa('.chip', qs('#filterChips')).forEach((chip) => {
    chip.addEventListener('click', () => {
      qsa('.chip', qs('#filterChips')).forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      recordsState.status = chip.dataset.status;
      render();
    });
  });

  qs('#btnExport').addEventListener('click', onExport);
  qs('#btnImport').addEventListener('click', () => qs('#importFile').click());
  qs('#importFile').addEventListener('change', onImport);

  function render() {
    const filtered = filterRepairs(recordsState.all, { keyword: recordsState.keyword, status: recordsState.status });
    qs('#resultCount').textContent = `共 ${filtered.length} 筆`;
    const container = qs('#caseList');
    container.innerHTML = '';
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🔍</div>找不到符合條件的案件</div>';
      return;
    }
    filtered.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'case-item';
      div.innerHTML = `
        <div class="case-item-main">
          <div class="case-item-id">${r.caseId}</div>
          <div class="case-item-meta">${(r.basic.customerName || '未填客戶')} · ${(r.basic.phoneModel || '未填型號')} · ${(r.basic.technician || '未填技師')} · ${formatDateOnly(r.updatedAt)}</div>
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

  async function onExport() {
    try {
      const payload = await exportRepairs();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const now = new Date();
      const filename = `repair_backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.json`;
      triggerBlobDownload(blob, filename);
      showToast('已匯出全部案件', 'success');
    } catch (e) {
      console.error(e);
      showToast('匯出失敗：' + e.message, 'error');
    }
  }

  async function onImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const result = await importRepairs(payload);
      let msg = `匯入完成，新增 ${result.importedCount} 筆案件`;
      if (result.skippedDuplicates.length) {
        msg += `\n以下案件已存在，無法重複匯入：\n${result.skippedDuplicates.join('、')}`;
      }
      await confirmDialog(msg, '確定', '關閉');
      recordsState.all = await getAllRepairs();
      render();
    } catch (err) {
      console.error(err);
      showBlockingError('匯入失敗：' + err.message);
    }
    e.target.value = '';
  }
})();
