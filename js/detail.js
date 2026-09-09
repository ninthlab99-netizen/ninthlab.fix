/* ============================================================
 * detail.js - 案件詳細頁（唯讀顯示 + PDF / 列印 / 繼續編輯）
 * ============================================================ */

let _detailRepair = null;
let _detailPdfCache = null;

(async function initDetail() {
  const caseId = getQueryParam('case');
  if (!caseId) { window.location.href = 'records.html'; return; }

  qs('#btnBackRecords').addEventListener('click', () => { window.location.href = 'records.html'; });

  try {
    _detailRepair = await getRepair(caseId);
  } catch (e) {
    console.error(e);
  }
  if (!_detailRepair) {
    showToast('找不到此案件：' + caseId, 'error');
    setTimeout(() => { window.location.href = 'records.html'; }, 1200);
    return;
  }

  qs('#topCaseId').textContent = _detailRepair.caseId;
  render();

  qs('#btnPrint').addEventListener('click', () => window.print());
  qs('#btnDownloadPdf').addEventListener('click', async () => {
    try {
      const r = await ensurePdf();
      triggerBlobDownload(r.blob, r.filename);
    } catch (e) {
      console.error(e);
      showToast('PDF 產生失敗：' + e.message, 'error');
    }
  });

  const primaryBtn = qs('#btnPrimaryAction');
  if (_detailRepair.status === 'completed') {
    qs('#lockNotice').style.display = '';
    primaryBtn.textContent = '📲 傳送至 LINE';
    primaryBtn.className = 'btn btn-line';
    primaryBtn.addEventListener('click', async () => {
      try { performLineHandoff(await ensurePdf()); } catch (e) { console.error(e); showToast('PDF 產生失敗：' + e.message, 'error'); }
    });
  } else {
    primaryBtn.textContent = '✏️ 繼續編輯';
    primaryBtn.addEventListener('click', () => {
      window.location.href = `wizard.html?case=${encodeURIComponent(_detailRepair.caseId)}`;
    });
  }

  ensurePdf().catch(() => {});
})();

async function ensurePdf() {
  if (_detailPdfCache) return _detailPdfCache;
  showToast('產生 PDF 中…');
  _detailPdfCache = await generateRepairPDF(_detailRepair);
  return _detailPdfCache;
}

function render() {
  const r = _detailRepair;
  const ap = r.preCheck.appearance;
  const dmg = r.preCheck.existingDamage;
  const dmgTexts = [];
  if (dmg.none) dmgTexts.push('無');
  if (dmg.screenCrack) dmgTexts.push('螢幕裂痕');
  if (dmg.backCrack) dmgTexts.push('背板裂痕');
  if (dmg.frameDent) dmgTexts.push('邊框凹傷');
  if (dmg.cameraBroken) dmgTexts.push('鏡頭破損');
  if (dmg.bodyDeformed) dmgTexts.push('機身變形');
  if (dmg.other) dmgTexts.push('其他：' + (dmg.otherText || ''));

  const fcLabels = {
    powerOn: '開機', screenTouch: '螢幕／觸控', cameras: '前後鏡頭',
    faceId: 'Face ID／生物辨識', speakerMic: '喇叭／麥克風',
    charging: '充電', flashlight: '手電筒', buttons: '按鍵',
  };
  const pcLabels = {
    powerOn: '可正常開機', screenTouch: '螢幕／觸控正常', repairFunction: '本次維修功能正常',
    camera: '相機正常', faceId: 'Face ID／生物辨識正常', charging: '充電正常',
    noOverheat: '無異常發熱／異味', noNewDamage: '外觀無新增損傷',
  };
  const itemLabels = { battery: '電池更換', screen: '螢幕更換', camera: '鏡頭更換', speaker: '喇叭／聽筒', chargingPort: '充電／尾插' };
  const partLabels = { original: '原廠', originalUsed: '原廠拆機', aftermarket: '副廠', other: '其他' };
  const items = r.repairContent.items;
  const chosenItems = Object.keys(itemLabels).filter((k) => items[k]).map((k) => itemLabels[k]);
  if (items.other) chosenItems.push('其他：' + (items.otherText || ''));

  function checkRow(label, val, note) {
    const cls = val === '異常' ? 'warn' : (val === '正常' ? 'ok' : '');
    return `<div class="summary-row"><div class="k">${label}</div><div class="v">${val || '未檢查'}${note ? '（' + note + '）' : ''}</div></div>`;
  }

  function photoStrip(urls) {
    const valid = urls.filter(Boolean);
    if (!valid.length) return '（無照片）';
    return `<div class="summary-photo-strip">${valid.map((u) => `<img src="${u}"/>`).join('')}</div>`;
  }

  qs('#detailContainer').innerHTML = `
    <div class="card">
      <div class="row-between">
        <div class="card-title" style="margin:0;">${r.caseId}</div>
        <span class="status-badge ${statusClass(r.status)}">${statusLabel(r.status)}</span>
      </div>
      <div class="summary-block" style="border-bottom:none; margin-top:12px;">
        <div class="summary-row"><div class="k">客戶姓名</div><div class="v">${r.basic.customerName || '—'}</div></div>
        <div class="summary-row"><div class="k">聯絡方式</div><div class="v">${r.basic.contact || '—'}</div></div>
        <div class="summary-row"><div class="k">手機型號</div><div class="v">${r.basic.phoneModel || '—'}</div></div>
        <div class="summary-row"><div class="k">技師</div><div class="v">${r.basic.technician || '—'}</div></div>
        <div class="summary-row"><div class="k">建立時間</div><div class="v">${formatDateTime(r.createdAt)}</div></div>
        <div class="summary-row"><div class="k">完成時間</div><div class="v">${r.completedAt ? formatDateTime(r.completedAt) : '—'}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">維修前外觀檢查</div>
      <div class="summary-block" style="border-bottom:none;">
        <div class="summary-row"><div class="k">螢幕</div><div class="v">${ap.screen || '未檢查'}</div></div>
        <div class="summary-row"><div class="k">背板</div><div class="v">${ap.back || '未檢查'}</div></div>
        <div class="summary-row"><div class="k">邊框</div><div class="v">${ap.frame || '未檢查'}</div></div>
        <div class="summary-row"><div class="k">鏡頭玻璃</div><div class="v">${ap.cameraGlass || '未檢查'}</div></div>
        <div class="summary-row"><div class="k">機身</div><div class="v">${ap.body || '未檢查'}</div></div>
        <div class="summary-row"><div class="k">既有損傷</div><div class="v">${dmgTexts.join('、') || '無'}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">維修前功能檢查</div>
      <div class="summary-block" style="border-bottom:none;">
        ${Object.keys(fcLabels).map((k) => {
          const item = r.preCheck.functionCheck[k] || {};
          return checkRow(fcLabels[k], item.status, item.note);
        }).join('')}
        ${r.preCheck.otherFault && r.preCheck.otherFault.has ? `<div class="summary-row"><div class="k">其他原有故障</div><div class="v">${r.preCheck.otherFault.text || '—'}</div></div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-title">維修前照片</div>
      ${photoStrip([r.prePhotos.front, r.prePhotos.back, r.prePhotos.repairArea, r.prePhotos.damage])}
    </div>

    <div class="card">
      <div class="card-title">本次維修項目</div>
      <div class="summary-block" style="border-bottom:none;">
        <div class="summary-row"><div class="k">維修項目</div><div class="v">${chosenItems.join('、') || '—'}</div></div>
        <div class="summary-row"><div class="k">維修金額</div><div class="v">${r.repairContent.price ? 'NT$ ' + r.repairContent.price : '—'}</div></div>
        <div class="summary-row"><div class="k">零件類型</div><div class="v">${partLabels[r.repairContent.partType] || '—'}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">維修完成檢查</div>
      <div class="summary-block" style="border-bottom:none;">
        ${Object.keys(pcLabels).map((k) => checkRow(pcLabels[k], r.postCheck.items[k])).join('')}
        <div class="summary-row"><div class="k">維修後異常</div><div class="v">${r.postCheck.abnormal.has ? (r.postCheck.abnormal.text || '有') : '無'}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">維修完成照片</div>
      ${photoStrip([r.postPhotos.front, r.postPhotos.back, r.postPhotos.repairArea])}
    </div>

    <div class="card">
      <div class="card-title">客戶確認 / 簽名</div>
      <div class="summary-sig-strip">
        <div class="sig-box">${r.signatures.customer ? `<img src="${r.signatures.customer}"/>` : '未簽名'}<div class="sig-cap">客戶簽名</div></div>
        <div class="sig-box">${r.signatures.technician ? `<img src="${r.signatures.technician}"/>` : '未簽名'}<div class="sig-cap">技師簽名</div></div>
      </div>
    </div>
  `;
}
