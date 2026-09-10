/* ============================================================
 * db.js - 資料存取層（改為 Firebase Firestore，支援跨裝置同步）
 *
 * 本檔案刻意把所有存取包成獨立函式（saveRepair / getRepair /
 * getAllRepairs / updateRepair / deleteRepair / allocateNextRepairNumber /
 * exportRepairs / importRepairs...），呼叫端（wizard.js / records.js /
 * detail.js / home.js）完全不需要修改，只有這個檔案內部的實作改變。
 *
 * 資料結構：
 *   repairs/{caseId}         主要案件資料（不含照片／簽名的實際圖片內容）
 *   repairs/{caseId}/media/* 每一張照片／簽名各自一份文件（見 MEDIA_FIELDS）
 *   meta/counter              全域案件編號計數器
 *
 * 為什麼照片要拆到 media 子集合，不是直接存在主文件裡？
 *   Firestore 單一文件大小上限是 1MB，一個案件最多可能有 9 張照片／
 *   簽名（維修前 4 張、維修後 3 張、簽名 2 張），全部塞在同一份文件
 *   很容易超過上限。拆開之後，getRepair() 會自動把 media 內容併回
 *   同樣的欄位路徑，saveRepair() 也會自動把圖片欄位拆出去，
 *   呼叫端看到的資料形狀完全不變。
 *
 * 案件編號規則（非常重要，請勿更動邏輯）：
 * 1. 編號只會往上增加，格式 REP-000001、REP-000002...
 * 2. 已用過的編號「絕對不回收」，即使案件被刪除。
 * 3. 使用 Firestore Transaction 同時讀寫 meta/counter 與新案件文件，
 *    Firestore 保證同一份文件在多個裝置／使用者同時搶編號時，
 *    Transaction 會自動偵測衝突並重試，因此不會發生兩個裝置拿到
 *    同一個編號的情況（這是舊版「只存在單一裝置 IndexedDB」時
 *    做不到的事）。
 * 4. 建立新案件（allocateNextRepairNumber）一定需要網路連線才能執行，
 *    這是為了徹底保證編號不重複，是刻意的設計取捨。
 *    但「編輯已建立的案件」（saveRepair / updateRepair）可以離線
 *    暫存，等網路恢復後 Firestore 會自動同步上去。
 * ============================================================ */

const _fsRepairs = () => fsDB.collection('repairs');
const _fsMeta = () => fsDB.collection('meta');
const COUNTER_DOC_ID = 'counter';

/* 需要拆到 media 子集合的欄位路徑（照片與簽名，皆為 dataURL 字串） */
const MEDIA_FIELDS = [
  'prePhotos.front', 'prePhotos.back', 'prePhotos.repairArea', 'prePhotos.damage',
  'postPhotos.front', 'postPhotos.back', 'postPhotos.repairArea',
  'signatures.customer', 'signatures.technician',
];
const MEDIA_FIELD_MAP = {}; // docId -> path
MEDIA_FIELDS.forEach((p) => { MEDIA_FIELD_MAP[p.replace('.', '_')] = p; });

// 記住每個案件上次實際寫入 media 的內容，避免每次 autosave（例如只是
// 打字改客戶姓名）都重新上傳所有照片，減少不必要的資料傳輸與寫入次數。
const _mediaWriteCache = new Map(); // caseId -> { path: value }

function formatCaseId(seq) {
  return CASE_ID_PREFIX + String(seq).padStart(CASE_ID_PAD_LENGTH, '0');
}

function parseSeqFromCaseId(caseId) {
  if (!caseId) return 0;
  const m = String(caseId).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

function createEmptyRepair(caseId, seq, now, basicDefaults) {
  return {
    caseId,
    seq,
    status: 'draft', // draft | in_progress | pending_confirmation | completed
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    currentStep: 1,
    basic: Object.assign({
      technician: '',
      customerName: '',
      contact: '',
      phoneModel: '',
      datetime: now,
    }, basicDefaults || {}),
    preCheck: {
      appearance: { screen: '', back: '', frame: '', cameraGlass: '', body: '' },
      existingDamage: {
        none: false, screenCrack: false, backCrack: false, frameDent: false,
        cameraBroken: false, bodyDeformed: false, other: false, otherText: ''
      },
      functionCheck: {
        powerOn: { status: '', note: '' },
        screenTouch: { status: '', note: '' },
        cameras: { status: '', note: '' },
        faceId: { status: '', note: '' },
        speakerMic: { status: '', note: '' },
        charging: { status: '', note: '' },
        flashlight: { status: '', note: '' },
        buttons: { status: '', note: '' },
      },
      otherFault: { has: false, text: '' },
    },
    repairContent: {
      items: {
        battery: false, screen: false, camera: false, speaker: false,
        chargingPort: false, other: false, otherText: ''
      },
      price: '',
      partType: '', // original | originalUsed | aftermarket | other
      partTypeOtherText: '',
    },
    prePhotos: { front: null, back: null, repairArea: null, damage: null },
    postCheck: {
      items: {
        powerOn: '', screenTouch: '', repairFunction: '', camera: '',
        faceId: '', charging: '', noOverheat: '', noNewDamage: ''
      },
      abnormal: { has: false, text: '' },
    },
    postPhotos: { front: null, back: null, repairArea: null },
    customerConfirm: {
      item1: false, item2: false, item3: false, item4: false, item5: false,
    },
    signatures: { customer: null, technician: null },
  };
}

/* ---------------- 舊版相容用（呼叫端仍會呼叫，這裡改為 no-op） ----------------
 * 舊版需要在啟動時校正 IndexedDB / localStorage 兩份備援資料，
 * 現在編號由 Firestore Transaction 保證正確，不需要額外校正。 */
async function reconcileCounter() {
  return;
}

/* ---------------- 產生下一個案件編號並建立草稿案件（原子操作，跨裝置安全） ---------------- */
async function allocateNextRepairNumber(basicDefaults) {
  const counterRef = _fsMeta().doc(COUNTER_DOC_ID);
  try {
    const record = await fsDB.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const current = counterSnap.exists ? (counterSnap.data().value || 0) : 0;
      const nextSeq = current + 1;
      const caseId = formatCaseId(nextSeq);
      const now = new Date().toISOString();
      const newRecord = createEmptyRepair(caseId, nextSeq, now, basicDefaults);
      tx.set(counterRef, { value: nextSeq });
      tx.set(_fsRepairs().doc(caseId), newRecord);
      return newRecord;
    });
    return record;
  } catch (e) {
    console.error(e);
    if (e && (e.code === 'unavailable' || String(e.message || '').indexOf('offline') !== -1)) {
      throw new Error('建立新案件需要網路連線（確保案件編號不重複），請確認網路後再試一次。');
    }
    throw new Error('案件編號產生失敗，請重試。');
  }
}

/* ---------------- 主文件 <-> 完整案件資料 互轉（處理 media 拆分／合併） ---------------- */
function _splitMediaFromRecord(record) {
  const mainData = JSON.parse(JSON.stringify(record));
  const mediaValues = {};
  for (const path of MEDIA_FIELDS) {
    const val = getPath(mainData, path) || null;
    mediaValues[path] = val;
    setPath(mainData, path, !!val); // 主文件只留「有沒有這張照片」的布林值
  }
  return { mainData, mediaValues };
}

async function _writeRecordFull(record) {
  const caseId = record.caseId;
  const { mainData, mediaValues } = _splitMediaFromRecord(record);
  await _fsRepairs().doc(caseId).set(mainData);
  const cache = {};
  const writes = Object.keys(mediaValues).map(async (path) => {
    const val = mediaValues[path];
    const mediaId = path.replace('.', '_');
    const mediaRef = _fsRepairs().doc(caseId).collection('media').doc(mediaId);
    if (val) {
      await mediaRef.set({ data: val });
    } else {
      await mediaRef.delete().catch(() => {});
    }
    cache[path] = val;
  });
  await Promise.all(writes);
  _mediaWriteCache.set(caseId, cache);
}

/* ---------------- 基本 CRUD ---------------- */

async function saveRepair(record) {
  record.updatedAt = new Date().toISOString();
  const caseId = record.caseId;
  const { mainData, mediaValues } = _splitMediaFromRecord(record);

  try {
    await _fsRepairs().doc(caseId).set(mainData);
  } catch (e) {
    console.error(e);
    throw new Error('資料保存失敗，請確認網路連線後再試。');
  }

  let cache = _mediaWriteCache.get(caseId);
  if (!cache) { cache = {}; _mediaWriteCache.set(caseId, cache); }

  const pendingWrites = [];
  for (const path of Object.keys(mediaValues)) {
    const val = mediaValues[path];
    if (cache[path] === val) continue; // 內容沒變，跳過，節省寫入次數
    const mediaId = path.replace('.', '_');
    const mediaRef = _fsRepairs().doc(caseId).collection('media').doc(mediaId);
    const p = (val ? mediaRef.set({ data: val }) : mediaRef.delete().catch(() => {}))
      .then(() => { cache[path] = val; });
    pendingWrites.push(p);
  }
  if (pendingWrites.length) {
    try {
      await Promise.all(pendingWrites);
    } catch (e) {
      console.error(e);
      // 主資料已經保存成功，照片同步失敗則不擋住整體流程，但仍記錄錯誤。
    }
  }

  return record;
}

// updateRepair 與 saveRepair 行為相同，保留獨立命名是為了符合 API 語意。
async function updateRepair(record) {
  return saveRepair(record);
}

async function getRepair(caseId) {
  const snap = await _fsRepairs().doc(caseId).get();
  if (!snap.exists) return null;
  const record = snap.data();

  const mediaSnap = await _fsRepairs().doc(caseId).collection('media').get();
  const cache = {};
  mediaSnap.forEach((d) => {
    const path = MEDIA_FIELD_MAP[d.id];
    if (!path) return;
    const val = (d.data() || {}).data || null;
    setPath(record, path, val);
    cache[path] = val;
  });
  // 補上目前沒有對應 media 文件（例如從未上傳過）的欄位快取，值為 null
  MEDIA_FIELDS.forEach((path) => { if (!(path in cache)) cache[path] = null; });
  _mediaWriteCache.set(caseId, cache);

  return record;
}

async function getAllRepairs() {
  const snap = await _fsRepairs().get();
  const list = [];
  snap.forEach((d) => list.push(d.data()));
  list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return list;
}

async function deleteRepair(caseId) {
  const mediaSnap = await _fsRepairs().doc(caseId).collection('media').get();
  await Promise.all(mediaSnap.docs.map((d) => d.ref.delete()));
  await _fsRepairs().doc(caseId).delete();
  _mediaWriteCache.delete(caseId);
  return true;
  // 注意：刪除案件不會、也不能讓流水號倒退或被重新使用。
}

/* ---------------- 案件編號重複檢查（建立 / 送出 / 匯入前都會呼叫） ---------------- */
async function isCaseIdTaken(caseId, ignoreSelf) {
  const existing = await getRepair(caseId);
  if (!existing) return false;
  if (ignoreSelf) return false; // 編輯自己既有草稿時，不算重複
  return true;
}

/* ---------------- 匯出 / 匯入 ---------------- */

async function exportRepairs() {
  const snap = await _fsRepairs().get();
  const caseIds = [];
  snap.forEach((d) => caseIds.push(d.id));
  const all = [];
  for (const caseId of caseIds) {
    const full = await getRepair(caseId); // 含 media 的完整內容
    if (full) all.push(full);
  }
  const counterSnap = await _fsMeta().doc(COUNTER_DOC_ID).get();
  const counterValue = counterSnap.exists ? (counterSnap.data().value || 0) : 0;
  return {
    exportedAt: new Date().toISOString(),
    appVersion: 1,
    counter: counterValue,
    repairs: all,
  };
}

/**
 * 匯入案件 JSON。
 * 回傳 { importedCount, skippedDuplicates: [caseId,...], newCounter }
 */
async function importRepairs(payload) {
  if (!payload || !Array.isArray(payload.repairs)) {
    throw new Error('匯入檔案格式不正確，找不到案件資料。');
  }
  const skippedDuplicates = [];
  let importedCount = 0;
  let maxSeqSeen = 0;

  for (const record of payload.repairs) {
    if (!record || !record.caseId) continue;
    const existingSnap = await _fsRepairs().doc(record.caseId).get();
    if (existingSnap.exists) {
      skippedDuplicates.push(record.caseId);
      continue;
    }
    const seq = record.seq || parseSeqFromCaseId(record.caseId);
    record.seq = seq;
    await _writeRecordFull(record);
    importedCount += 1;
    if (seq > maxSeqSeen) maxSeqSeen = seq;
  }

  // 如果匯入資料的編號比目前流水號更大，更新流水號（絕不減少）
  const payloadCounter = typeof payload.counter === 'number' ? payload.counter : 0;
  const candidateMax = Math.max(maxSeqSeen, payloadCounter);
  let newCounter = candidateMax;
  if (candidateMax > 0) {
    const counterRef = _fsMeta().doc(COUNTER_DOC_ID);
    newCounter = await fsDB.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? (snap.data().value || 0) : 0;
      const next = Math.max(current, candidateMax);
      tx.set(counterRef, { value: next });
      return next;
    });
  }

  return { importedCount, skippedDuplicates, newCounter };
}

/* ---------------- 搜尋 / 篩選（於記憶體中對 getAllRepairs 結果做過濾即可，
 * 案件量對單一維修店而言不會太大，不需要額外索引複雜化） ---------------- */
function filterRepairs(list, { keyword, status } = {}) {
  let result = list;
  if (status && status !== 'all') {
    result = result.filter((r) => r.status === status);
  }
  if (keyword && keyword.trim()) {
    const kw = keyword.trim().toLowerCase();
    result = result.filter((r) => {
      const fields = [
        r.caseId,
        r.basic && r.basic.customerName,
        r.basic && r.basic.phoneModel,
        r.basic && r.basic.datetime,
        r.createdAt,
      ];
      return fields.some((f) => f && String(f).toLowerCase().includes(kw));
    });
  }
  return result;
}
