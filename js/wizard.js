/* ============================================================
 * wizard.js - 建立／編輯案件 多步驟表單
 * ============================================================ */

const TOTAL_STEPS = 12;
const STEP_TITLES = {
  1: '基本資料', 2: '維修前外觀檢查', 3: '維修前功能檢查', 4: '維修前照片',
  5: '本次維修項目', 6: '進行維修', 7: '維修完成檢查', 8: '維修完成照片',
  9: '客戶確認', 10: '客戶手寫簽名', 11: '技師確認簽名', 12: '確認資料',
};

const FUNCTION_CHECK_FIELDS = [
  ['powerOn', '開機'], ['screenTouch', '螢幕／觸控'], ['cameras', '前後鏡頭'],
  ['faceId', 'Face ID／生物辨識'], ['speakerMic', '喇叭／麥克風'],
  ['charging', '充電'], ['flashlight', '手電筒'], ['buttons', '按鍵'],
];

const POST_CHECK_FIELDS = [
  ['powerOn', '可正常開機'], ['screenTouch', '螢幕／觸控正常'], ['repairFunction', '本次維修功能正常'],
  ['camera', '相機正常'], ['faceId', 'Face ID／生物辨識正常'], ['charging', '充電正常'],
  ['noOverheat', '無異常發熱／異味'], ['noNewDamage', '外觀無新增損傷'],
];

const state = {
  repair: null,
  step: 1,
  customerPad: null,
  techPad: null,
};

(async function initWizard() {
  const caseId = getQueryParam('case');
  if (!caseId) { window.location.href = 'index.html'; return; }

  try {
    const record = await getRepair(caseId);
    if (!record) {
      showToast('找不到此案件：' + caseId, 'error');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
      return;
    }
    if (record.status === 'completed') {
      // 已完成案件不可進入編輯流程
      window.location.href = `detail.html?case=${encodeURIComponent(caseId)}`;
      return;
    }
    state.repair = record;
    state.step = clampStep(record.currentStep || 1);
  } catch (e) {
    console.error(e);
    showToast('載入案件失敗：' + e.message, 'error');
    return;
  }

  qs('#caseIdField').value = state.repair.caseId;
  qs('#datetimeField').value = formatDateTime(state.repair.basic.datetime || state.repair.createdAt);
  qs('#topCaseId').textContent = state.repair.caseId;

  renderFunctionChecklist(qs('#preFunctionChecklist'), 'preCheck.functionCheck', FUNCTION_CHECK_FIELDS, false);
  renderFunctionChecklist(qs('#postFunctionChecklist'), 'postCheck.items', POST_CHECK_FIELDS, true);
  renderPhotoSlots();
  buildStepProgress();
  bindAllInputs();
  initSignaturePads();

  qs('#btnBackHome').addEventListener('click', onBackToHome);
  qs('#btnBackHome2').addEventListener('click', () => { window.location.href = 'index.html'; });
  qs('#btnPrevStep').addEventListener('click', () => goToStep(state.step - 1));
  qs('#btnNextStep').addEventListener('click', onNextStep);
  qs('#btnSaveDraft').addEventListener('click', () => saveNow(true));
  qs('#btnRepairDone').addEventListener('click', () => goToStep(state.step + 1));

  qs('#btnClearCustomerSig').addEventListener('click', () => { state.customerPad.clear(); syncSignatureState('customer'); });
  qs('#btnRedoCustomerSig').addEventListener('click', () => { state.customerPad.clear(); syncSignatureState('customer'); });
  qs('#btnClearTechSig').addEventListener('click', () => { state.techPad.clear(); syncSignatureState('tech'); });
  qs('#btnRedoTechSig').addEventListener('click', () => { state.techPad.clear(); syncSignatureState('tech'); });

  renderStep();

  window.addEventListener('beforeunload', () => {
    // 盡力保存，不保證非同步完成，但主流程已在每次變更時 autosave
  });
})();

function clampStep(n) { return Math.min(TOTAL_STEPS, Math.max(1, n)); }

async function onBackToHome() {
  await saveNow(false);
  window.location.href = 'index.html';
}

/* ---------------- 步驟進度條 ---------------- */
function buildStepProgress() {
  const wrap = qs('#stepProgress');
  wrap.innerHTML = '';
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.dataset.step = i;
    wrap.appendChild(dot);
  }
}

function renderStep() {
  qsa('.step').forEach((sec) => {
    sec.style.display = (parseInt(sec.dataset.step, 10) === state.step) ? '' : 'none';
  });
  qsa('#stepProgress .dot').forEach((dot) => {
    const n = parseInt(dot.dataset.step, 10);
    dot.classList.toggle('active', n === state.step);
    dot.classList.toggle('done', n < state.step);
  });
  qs('#stepLabel').textContent = `步驟 ${state.step}／${TOTAL_STEPS}`;
  qs('#topStepTitle').textContent = STEP_TITLES[state.step];

  const isFirst = state.step === 1;
  const isLast = state.step === TOTAL_STEPS;
  const isInterstitial = state.step === 6;
  qs('#btnPrevStep').style.visibility = isFirst ? 'hidden' : 'visible';
  qs('#bottomNav').style.display = isInterstitial ? 'none' : 'flex';
  qs('#btnNextStep').textContent = isLast ? '確認送出' : '下一步';
  qs('#btnNextStep').onclick = isLast ? onFinalSubmit : onNextStep;

  if (state.step === 12) renderSummary();
  refreshAllBindings();
  updateConditionalVisibility();

  window.scrollTo(0, 0);
}

async function goToStep(n) {
  n = clampStep(n);
  state.repair.currentStep = n;
  await saveNow(false);
  state.step = n;
  renderStep();
}

async function onNextStep() {
  // 部分步驟在離開前需要先驗證
  if (state.step === 9) {
    const cc = state.repair.customerConfirm;
    const allChecked = cc.item1 && cc.item2 && cc.item3 && cc.item4 && cc.item5;
    if (!allChecked) {
      showBlockingError('請完成必要欄位：客戶確認項目需全部勾選');
      return;
    }
  }
  if (state.step === 10) {
    if (!state.customerPad || state.customerPad.isEmpty()) {
      showBlockingError('請完成客戶簽名');
      return;
    }
  }
  if (state.step === 11) {
    if (!state.techPad || state.techPad.isEmpty()) {
      showBlockingError('請完成技師簽名');
      return;
    }
  }
  if (state.repair.status === 'draft') {
    state.repair.status = 'in_progress';
  }
  if (state.step === 8) {
    state.repair.status = 'pending_confirmation';
  }
  await goToStep(state.step + 1);
}

/* ---------------- 自動保存 ---------------- */
const scheduleAutosave = debounce(() => { saveNow(false); }, 600);

async function saveNow(showFeedback) {
  if (!state.repair) return;
  try {
    if (state.repair.status === 'draft' && hasAnyProgress()) {
      state.repair.status = 'in_progress';
    }
    await updateRepair(state.repair);
    if (state.repair.basic.technician) {
      try { localStorage.setItem('repairShop_lastTechnician', state.repair.basic.technician); } catch (e) {}
    }
    if (showFeedback) showToast('已儲存草稿', 'success');
  } catch (e) {
    console.error(e);
    showBlockingError('資料保存失敗，請確認瀏覽器儲存空間後再試。');
  }
}

function hasAnyProgress() {
  const b = state.repair.basic;
  return !!(b.technician || b.customerName || b.contact || b.phoneModel);
}

/* ---------------- 通用欄位綁定 ---------------- */
function bindAllInputs() {
  const form = qs('#wizardForm');

  qsa('input[data-bind], textarea[data-bind]', form).forEach((el) => {
    const path = el.dataset.bind;
    el.value = getPath(state.repair, path) || '';
    el.addEventListener('input', () => {
      let val = el.value;
      if (el.type === 'number' && val !== '') val = val.replace(/[^0-9.]/g, '');
      setPath(state.repair, path, val);
      onFieldChanged(path);
      scheduleAutosave();
    });
  });

  qsa('.choice-group[data-bind]', form).forEach((group) => {
    const path = group.dataset.bind;
    const isBool = group.dataset.boolChoice === '1';
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.choice-btn');
      if (!btn) return;
      const raw = btn.dataset.value;
      const val = isBool ? (raw === 'true') : raw;
      setPath(state.repair, path, val);
      refreshChoiceGroup(group);
      onFieldChanged(path);
      scheduleAutosave();
    });
    refreshChoiceGroup(group);
  });

  qsa('.tap-check[data-bind]', form).forEach((el) => {
    const path = el.dataset.bind;
    el.addEventListener('click', () => {
      const cur = !!getPath(state.repair, path);
      setPath(state.repair, path, !cur);
      refreshTapCheck(el);
      onFieldChanged(path);
      scheduleAutosave();
    });
    refreshTapCheck(el);
  });
}

function refreshChoiceGroup(group) {
  const path = group.dataset.bind;
  const isBool = group.dataset.boolChoice === '1';
  const val = getPath(state.repair, path);
  qsa('.choice-btn', group).forEach((btn) => {
    const raw = btn.dataset.value;
    const matched = isBool ? ((raw === 'true') === !!val) : (raw === val);
    btn.classList.toggle('selected', matched && (isBool || (val !== '' && val != null)));
    if (btn.dataset.value === '異常' || btn.dataset.value === '已有損傷' || btn.dataset.value === '彎曲／變形') {
      btn.classList.toggle('warn', matched);
    }
    if (btn.dataset.value === '正常') {
      btn.classList.toggle('ok', matched);
    }
  });
}

function refreshTapCheck(el) {
  const path = el.dataset.bind;
  const val = !!getPath(state.repair, path);
  el.classList.toggle('checked', val);
  qs('.box', el).textContent = val ? '✓' : '';
}

function refreshAllBindings() {
  const form = qs('#wizardForm');
  qsa('input[data-bind], textarea[data-bind]', form).forEach((el) => {
    const path = el.dataset.bind;
    const v = getPath(state.repair, path);
    if (document.activeElement !== el) el.value = (v === undefined || v === null) ? '' : v;
  });
  qsa('.choice-group[data-bind]', form).forEach(refreshChoiceGroup);
  qsa('.tap-check[data-bind]', form).forEach(refreshTapCheck);
}

function onFieldChanged(path) {
  updateConditionalVisibility();
  if (path.indexOf('preCheck.functionCheck') === 0) refreshFunctionChecklistUI('preFunctionChecklist');
  if (path.indexOf('postCheck.items') === 0) refreshFunctionChecklistUI('postFunctionChecklist');
}

function updateConditionalVisibility() {
  qsa('[data-show-if]').forEach((el) => {
    const path = el.dataset.showIf;
    const expect = el.dataset.showIfValue;
    const val = getPath(state.repair, path);
    const show = expect !== undefined ? (val === expect) : !!val;
    el.style.display = show ? '' : 'none';
  });
}

/* ---------------- 三態功能檢查清單（動態產生 8 項） ---------------- */
function renderFunctionChecklist(container, basePath, fields, isPostCheck) {
  container.innerHTML = fields.map(([key, label]) => {
    const notePath = isPostCheck ? null : `${basePath}.${key}.note`;
    const statusPath = isPostCheck ? `${basePath}.${key}` : `${basePath}.${key}.status`;
    return `
      <div class="check-item" data-check-key="${key}">
        <div class="check-item-title">${label}</div>
        <div class="choice-group" data-bind="${statusPath}">
          <button type="button" class="choice-btn" data-value="正常">正常</button>
          <button type="button" class="choice-btn" data-value="異常">異常</button>
          <button type="button" class="choice-btn" data-value="無法測試">無法測試</button>
        </div>
        ${notePath ? `
        <div class="field choice-note" data-show-if="${statusPath}" data-show-if-value="異常" style="display:none;">
          <textarea class="input" data-bind="${notePath}" placeholder="請簡短說明異常狀況"></textarea>
        </div>` : ''}
      </div>`;
  }).join('');
}

function refreshFunctionChecklistUI(containerId) {
  // check-item 內的 choice-group / textarea 是動態插入的，需要重新綁定一次顯示狀態
  const container = qs('#' + containerId);
  qsa('.choice-group[data-bind]', container).forEach(refreshChoiceGroup);
}

/* ---------------- 照片區塊 ---------------- */
const PHOTO_SLOTS = [];
function renderPhotoSlots() {
  qsa('.photo-slot-wrap').forEach((wrap) => {
    const path = wrap.dataset.photoSlot;
    const label = wrap.dataset.photoLabel;
    const required = wrap.dataset.photoRequired === '1';
    const inputId = 'photoInput_' + path.replace(/\./g, '_');
    wrap.innerHTML = `
      <div class="photo-slot" data-slot-path="${path}">
        <input type="file" accept="image/*" capture="environment" id="${inputId}" />
        <div class="slot-empty-content">
          <div class="plus-icon">📷</div>
          <div class="slot-label">${label}${required ? ' <span class="slot-required">＊</span>' : ''}</div>
        </div>
      </div>`;
    PHOTO_SLOTS.push(path);
    const slotEl = qs('.photo-slot', wrap);
    const inputEl = qs('input', slotEl);

    inputEl.addEventListener('change', async () => {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      showToast('處理照片中…');
      try {
        const dataUrl = await compressImageFile(file);
        setPath(state.repair, path, dataUrl);
        renderPhotoSlotContent(slotEl, path, label, required);
        scheduleAutosave();
      } catch (e) {
        console.error(e);
        showToast('照片處理失敗，請重試', 'error');
      }
      inputEl.value = '';
    });

    slotEl.addEventListener('click', (e) => {
      if (e.target.closest('.photo-actions')) return;
      inputEl.click();
    });

    renderPhotoSlotContent(slotEl, path, label, required);
  });
}

function renderPhotoSlotContent(slotEl, path, label, required) {
  const dataUrl = getPath(state.repair, path);
  const inputEl = qs('input', slotEl);
  slotEl.querySelectorAll('img, .photo-actions, .slot-empty-content').forEach((el) => el.remove());
  slotEl.appendChild(inputEl); // 保留 input

  if (dataUrl) {
    const img = document.createElement('img');
    img.src = dataUrl;
    slotEl.appendChild(img);
    const actions = document.createElement('div');
    actions.className = 'photo-actions';
    actions.innerHTML = `<button type="button" data-act="retake">重新拍攝</button><button type="button" data-act="upload">重新上傳</button><button type="button" data-act="delete">刪除</button>`;
    slotEl.appendChild(actions);
    actions.querySelector('[data-act="retake"]').addEventListener('click', (e) => { e.stopPropagation(); inputEl.click(); });
    actions.querySelector('[data-act="upload"]').addEventListener('click', (e) => { e.stopPropagation(); inputEl.removeAttribute('capture'); inputEl.click(); inputEl.setAttribute('capture', 'environment'); });
    actions.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('確定要刪除這張照片嗎？', '刪除', '取消');
      if (!ok) return;
      setPath(state.repair, path, null);
      renderPhotoSlotContent(slotEl, path, label, required);
      scheduleAutosave();
    });
  } else {
    const content = document.createElement('div');
    content.className = 'slot-empty-content';
    content.innerHTML = `<div class="plus-icon">📷</div><div class="slot-label">${label}${required ? ' <span class="slot-required">＊</span>' : ''}</div>`;
    slotEl.appendChild(content);
  }
}

/* ---------------- 簽名板 ---------------- */
function initSignaturePads() {
  state.customerPad = new SignaturePad(qs('#sigCustomer'));
  state.techPad = new SignaturePad(qs('#sigTech'));

  if (state.repair.signatures.customer) {
    drawExistingSignature(state.customerPad, state.repair.signatures.customer);
  }
  if (state.repair.signatures.technician) {
    drawExistingSignature(state.techPad, state.repair.signatures.technician);
  }
  syncSignatureState('customer');
  syncSignatureState('tech');

  qs('#sigCustomer').addEventListener('pointerup', () => setTimeout(() => syncSignatureState('customer'), 50));
  qs('#sigTech').addEventListener('pointerup', () => setTimeout(() => syncSignatureState('tech'), 50));
}

function drawExistingSignature(pad, dataUrl) {
  const img = new Image();
  img.onload = () => {
    pad.ctx.drawImage(img, 0, 0, pad.canvas.getBoundingClientRect().width, pad.canvas.getBoundingClientRect().height);
    pad.hasInk = true;
  };
  img.src = dataUrl;
}

function syncSignatureState(who) {
  const pad = who === 'customer' ? state.customerPad : state.techPad;
  const statusEl = who === 'customer' ? qs('#customerSigStatus') : qs('#techSigStatus');
  const field = who === 'customer' ? 'customer' : 'technician';
  if (pad.isEmpty()) {
    state.repair.signatures[field] = null;
    statusEl.textContent = '尚未簽名';
    statusEl.className = 'sig-status pending';
  } else {
    state.repair.signatures[field] = pad.toDataURL();
    statusEl.textContent = '已完成簽名';
    statusEl.className = 'sig-status done';
    scheduleAutosave();
  }
}

/* ---------------- Step 12 摘要 ---------------- */
function renderSummary() {
  const r = state.repair;
  const dmgTexts = [];
  const dmg = r.preCheck.existingDamage;
  if (dmg.none) dmgTexts.push('無');
  if (dmg.screenCrack) dmgTexts.push('螢幕裂痕');
  if (dmg.backCrack) dmgTexts.push('背板裂痕');
  if (dmg.frameDent) dmgTexts.push('邊框凹傷');
  if (dmg.cameraBroken) dmgTexts.push('鏡頭破損');
  if (dmg.bodyDeformed) dmgTexts.push('機身變形');
  if (dmg.other) dmgTexts.push('其他：' + (dmg.otherText || ''));

  const itemLabels = { battery: '電池更換', screen: '螢幕更換', camera: '鏡頭更換', speaker: '喇叭／聽筒', chargingPort: '充電／尾插' };
  const items = r.repairContent.items;
  const chosenItems = Object.keys(itemLabels).filter((k) => items[k]).map((k) => itemLabels[k]);
  if (items.other) chosenItems.push('其他：' + (items.otherText || ''));
  const partLabels = { original: '原廠', originalUsed: '原廠拆機', aftermarket: '副廠', other: '其他' };

  const prePhotoUrls = [r.prePhotos.front, r.prePhotos.back, r.prePhotos.repairArea, r.prePhotos.damage].filter(Boolean);
  const postPhotoUrls = [r.postPhotos.front, r.postPhotos.back, r.postPhotos.repairArea].filter(Boolean);

  qs('#summaryContainer').innerHTML = `
    <div class="summary-block">
      <h3>維修資料</h3>
      <div class="summary-row"><div class="k">案件編號</div><div class="v">${r.caseId}</div></div>
      <div class="summary-row"><div class="k">客戶姓名</div><div class="v">${r.basic.customerName || '—'}</div></div>
      <div class="summary-row"><div class="k">手機型號</div><div class="v">${r.basic.phoneModel || '—'}</div></div>
      <div class="summary-row"><div class="k">技師</div><div class="v">${r.basic.technician || '—'}</div></div>
      <div class="summary-row"><div class="k">建立時間</div><div class="v">${formatDateTime(r.createdAt)}</div></div>
    </div>
    <div class="summary-block">
      <h3>維修內容</h3>
      <div class="summary-row"><div class="k">維修項目</div><div class="v">${chosenItems.join('、') || '—'}</div></div>
      <div class="summary-row"><div class="k">維修金額</div><div class="v">${r.repairContent.price ? 'NT$ ' + r.repairContent.price : '—'}</div></div>
      <div class="summary-row"><div class="k">零件類型</div><div class="v">${partLabels[r.repairContent.partType] || '—'}</div></div>
    </div>
    <div class="summary-block">
      <h3>維修前</h3>
      <div class="summary-row"><div class="k">外觀</div><div class="v">螢幕:${r.preCheck.appearance.screen || '—'} 背板:${r.preCheck.appearance.back || '—'} 邊框:${r.preCheck.appearance.frame || '—'}</div></div>
      <div class="summary-row"><div class="k">既有損傷</div><div class="v">${dmgTexts.join('、') || '—'}</div></div>
      <div class="summary-photo-strip">${prePhotoUrls.map((u) => `<img src="${u}"/>`).join('') || '（無照片）'}</div>
    </div>
    <div class="summary-block">
      <h3>維修後</h3>
      <div class="summary-row"><div class="k">功能</div><div class="v">${POST_CHECK_FIELDS.map(([k,l]) => r.postCheck.items[k]).filter(Boolean).length}／8 項已檢查</div></div>
      <div class="summary-row"><div class="k">異常</div><div class="v">${r.postCheck.abnormal.has ? (r.postCheck.abnormal.text || '有') : '無'}</div></div>
      <div class="summary-photo-strip">${postPhotoUrls.map((u) => `<img src="${u}"/>`).join('') || '（無照片）'}</div>
    </div>
    <div class="summary-block">
      <h3>簽名</h3>
      <div class="summary-sig-strip">
        <div class="sig-box">${r.signatures.customer ? `<img src="${r.signatures.customer}"/>` : '未簽名'}<div class="sig-cap">客戶簽名</div></div>
        <div class="sig-box">${r.signatures.technician ? `<img src="${r.signatures.technician}"/>` : '未簽名'}<div class="sig-cap">技師簽名</div></div>
      </div>
    </div>
    <button type="button" class="btn btn-secondary" id="btnBackEdit" style="margin-top:6px;">← 返回修改</button>
  `;
  qs('#btnBackEdit').addEventListener('click', () => goToStep(1));
}

/* ---------------- 最終送出驗證與流程 ---------------- */
function validateForSubmit() {
  const r = state.repair;
  const missing = [];

  if (!r.basic.technician) missing.push('技師姓名');
  if (!r.basic.customerName) missing.push('客戶姓名');
  if (!r.basic.phoneModel) missing.push('手機型號');

  const items = r.repairContent.items;
  const anyItem = items.battery || items.screen || items.camera || items.speaker || items.chargingPort || items.other;
  if (!anyItem) missing.push('本次維修項目（至少選擇一項）');
  if (!r.repairContent.price) missing.push('維修金額');
  if (!r.repairContent.partType) missing.push('零件類型');

  if (!r.prePhotos.front || !r.prePhotos.back || !r.prePhotos.repairArea) missing.push('維修前必要照片（正面／背面／維修部位）');
  if (!r.postPhotos.front || !r.postPhotos.back || !r.postPhotos.repairArea) missing.push('維修完成必要照片（正面／背面／維修部位）');

  const cc = r.customerConfirm;
  if (!(cc.item1 && cc.item2 && cc.item3 && cc.item4 && cc.item5)) missing.push('客戶確認（所有項目）');

  if (!r.signatures.customer) missing.push('客戶簽名');
  if (!r.signatures.technician) missing.push('技師簽名');

  return missing;
}

async function onFinalSubmit() {
  const btn = qs('#btnNextStep');
  btn.disabled = true;
  try {
    // 1+2. 案件編號 / 重複檢查
    const fresh = await getRepair(state.repair.caseId);
    if (!fresh) {
      showBlockingError('案件編號已存在，禁止送出。');
      btn.disabled = false;
      return;
    }
    if (fresh.status === 'completed' && fresh.updatedAt !== state.repair.updatedAt) {
      showBlockingError('此案件已在其他地方完成送出，無法重複送出。');
      btn.disabled = false;
      return;
    }

    // 3-8. 必填資料 / 客戶確認 / 簽名 / 照片 / 維修內容
    const missing = validateForSubmit();
    if (missing.length) {
      showBlockingError('請完成必要欄位：' + missing.join('、'));
      btn.disabled = false;
      return;
    }

    state.repair.status = 'completed';
    state.repair.completedAt = new Date().toISOString();
    await updateRepair(state.repair);

    showCompletionScreen();
  } catch (e) {
    console.error(e);
    showBlockingError('資料保存失敗，請確認瀏覽器儲存空間後再試。');
  } finally {
    btn.disabled = false;
  }
}

async function showCompletionScreen() {
  qs('#wizardForm').style.display = 'none';
  qs('#bottomNav').style.display = 'none';
  qs('#stepProgress').style.display = 'none';
  qs('#stepLabel').style.display = 'none';
  qs('#completionScreen').style.display = '';
  qs('#doneCaseId').textContent = state.repair.caseId;
  qs('#topStepTitle').textContent = '案件已完成';

  let pdfResult = null;
  async function ensurePdf() {
    if (pdfResult) return pdfResult;
    showToast('產生 PDF 中…');
    pdfResult = await generateRepairPDF(state.repair);
    return pdfResult;
  }

  qs('#btnViewPdf').addEventListener('click', async () => {
    try { openBlobInNewTab((await ensurePdf()).blob); } catch (e) { console.error(e); showToast('PDF 產生失敗：' + e.message, 'error'); }
  });
  qs('#btnDownloadPdf').addEventListener('click', async () => {
    try { const r = await ensurePdf(); triggerBlobDownload(r.blob, r.filename); } catch (e) { console.error(e); showToast('PDF 產生失敗：' + e.message, 'error'); }
  });
  qs('#btnRedownloadPdf').addEventListener('click', async () => {
    try { const r = await ensurePdf(); triggerBlobDownload(r.blob, r.filename); showToast('已重新下載 PDF', 'success'); } catch (e) { console.error(e); showToast('PDF 產生失敗：' + e.message, 'error'); }
  });
  qs('#btnSendLine').addEventListener('click', async () => {
    try { performLineHandoff(await ensurePdf()); } catch (e) { console.error(e); showToast('PDF 產生失敗：' + e.message, 'error'); }
  });

  // 預先產生一次，讓技師點按鈕時幾乎無延遲
  ensurePdf().catch((e) => console.error(e));
}
