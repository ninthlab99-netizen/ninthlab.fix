/* ============================================================
 * db.js - 資料存取層 (IndexedDB)
 *
 * 目前為純靜態網站，所有資料保存在「此裝置瀏覽器」的 IndexedDB。
 * 本檔案刻意把所有存取包成獨立函式（saveRepair / getRepair /
 * getAllRepairs / updateRepair / deleteRepair / generateRepairNumber /
 * exportRepairs / importRepairs...），未來要換成 Firebase、Supabase
 * 或自建 API 時，只需要替換這些函式內部的實作即可，呼叫端不用改。
 *
 * 案件編號規則（非常重要，請勿更動邏輯）：
 * 1. 編號只會往上增加，格式 REP-000001、REP-000002...
 * 2. 已用過的編號「絕對不回收」，即使案件被刪除。
 * 3. 使用單一 IndexedDB readwrite transaction 同時操作 counter
 *    與 repairs 兩個 store，IndexedDB 保證同一個資料庫的
 *    readwrite transaction 會被序列化執行（即使跨分頁），
 *    因此可以避免「同時建立兩個案件」或「多分頁同時建立」
 *    產生相同編號的問題。
 * 4. 另外用 localStorage 做一層備援鏡像，並在 App 啟動時與
 *    IndexedDB 中所有案件的實際最大編號做校正，
 *    避免「IndexedDB 與 LocalStorage 資料不一致」造成編號重複或倒退。
 * ============================================================ */

const DB_NAME = 'repairShopDB';
const DB_VERSION = 1;
const STORE_REPAIRS = 'repairs';
const STORE_COUNTER = 'counter';
const COUNTER_KEY = 'main';
const LS_COUNTER_BACKUP = 'repairShop_counterBackup';
const LS_DRAFT_HINT = 'repairShop_lastDraftCaseId';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('此瀏覽器不支援 IndexedDB，無法保存案件資料。'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_REPAIRS)) {
        const store = db.createObjectStore(STORE_REPAIRS, { keyPath: 'caseId' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('customerName', 'basic.customerName', { unique: false });
        store.createIndex('phoneModel', 'basic.phoneModel', { unique: false });
        store.createIndex('seq', 'seq', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORE_COUNTER)) {
        db.createObjectStore(STORE_COUNTER, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error || new Error('IndexedDB 開啟失敗'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他分頁鎖定，請關閉其他分頁後重試。'));
  });
  return _dbPromise;
}

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

/* ---------------- 啟動時校正流水號（防止 IDB / LS 不一致） ---------------- */
async function reconcileCounter() {
  const db = await openDB();
  const maxSeqInRepairs = await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_REPAIRS], 'readonly');
    const store = tx.objectStore(STORE_REPAIRS);
    const index = store.index('seq');
    let max = 0;
    const cursorReq = index.openCursor(null, 'prev');
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        max = cursor.value.seq || 0;
      }
      resolve(max);
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  let lsBackup = 0;
  try {
    lsBackup = parseInt(localStorage.getItem(LS_COUNTER_BACKUP) || '0', 10) || 0;
  } catch (e) { /* localStorage 不可用時忽略 */ }

  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_COUNTER], 'readwrite');
    const store = tx.objectStore(STORE_COUNTER);
    const getReq = store.get(COUNTER_KEY);
    getReq.onsuccess = () => {
      const current = getReq.result ? getReq.result.value : 0;
      const best = Math.max(current, maxSeqInRepairs, lsBackup);
      if (best !== current) {
        store.put({ id: COUNTER_KEY, value: best });
      }
      try { localStorage.setItem(LS_COUNTER_BACKUP, String(best)); } catch (e) {}
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- 產生下一個案件編號並建立草稿案件（原子操作） ---------------- */
async function allocateNextRepairNumber(basicDefaults) {
  await reconcileCounter();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_COUNTER, STORE_REPAIRS], 'readwrite');
    const counterStore = tx.objectStore(STORE_COUNTER);
    const repairsStore = tx.objectStore(STORE_REPAIRS);
    let resultRecord = null;

    const getReq = counterStore.get(COUNTER_KEY);
    getReq.onsuccess = () => {
      const current = getReq.result ? getReq.result.value : 0;

      function tryAllocate(candidateSeq) {
        const caseId = formatCaseId(candidateSeq);
        const checkReq = repairsStore.get(caseId);
        checkReq.onsuccess = () => {
          if (checkReq.result) {
            // 該編號已被使用（理論上不會發生，屬防呆），往下一個嘗試
            tryAllocate(candidateSeq + 1);
            return;
          }
          counterStore.put({ id: COUNTER_KEY, value: candidateSeq });
          const now = new Date().toISOString();
          resultRecord = createEmptyRepair(caseId, candidateSeq, now, basicDefaults);
          const addReq = repairsStore.add(resultRecord);
          addReq.onerror = (e) => {
            e.preventDefault && e.preventDefault();
            tryAllocate(candidateSeq + 1);
          };
        };
        checkReq.onerror = () => reject(checkReq.error);
      }

      tryAllocate(current + 1);
    };
    getReq.onerror = () => reject(getReq.error);

    tx.oncomplete = () => {
      if (!resultRecord) {
        reject(new Error('案件編號產生失敗，請重試。'));
        return;
      }
      try { localStorage.setItem(LS_COUNTER_BACKUP, String(resultRecord.seq)); } catch (e) {}
      resolve(resultRecord);
    };
    tx.onerror = () => reject(tx.error || new Error('案件編號產生失敗'));
    tx.onabort = () => reject(tx.error || new Error('案件編號產生失敗'));
  });
}

/* ---------------- 基本 CRUD ---------------- */

async function saveRepair(record) {
  const db = await openDB();
  record.updatedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_REPAIRS], 'readwrite');
    tx.objectStore(STORE_REPAIRS).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error || new Error('資料保存失敗，請確認瀏覽器儲存空間後再試。'));
  });
}

// updateRepair 與 saveRepair 行為相同（put = 新增或覆寫），保留獨立命名
// 是為了符合未來 API 語意（saveRepair -> create-or-put, updateRepair -> PATCH-like）
async function updateRepair(record) {
  return saveRepair(record);
}

async function getRepair(caseId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_REPAIRS], 'readonly');
    const req = tx.objectStore(STORE_REPAIRS).get(caseId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllRepairs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_REPAIRS], 'readonly');
    const req = tx.objectStore(STORE_REPAIRS).getAll();
    req.onsuccess = () => {
      const list = req.result || [];
      list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteRepair(caseId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_REPAIRS], 'readwrite');
    tx.objectStore(STORE_REPAIRS).delete(caseId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
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
  const all = await getAllRepairs();
  const db = await openDB();
  const counterValue = await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_COUNTER], 'readonly');
    const req = tx.objectStore(STORE_COUNTER).get(COUNTER_KEY);
    req.onsuccess = () => resolve(req.result ? req.result.value : 0);
    req.onerror = () => reject(req.error);
  });
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
  const db = await openDB();
  const skippedDuplicates = [];
  let importedCount = 0;
  let maxSeqSeen = 0;

  for (const record of payload.repairs) {
    if (!record || !record.caseId) continue;
    const seq = record.seq || parseSeqFromCaseId(record.caseId);
    record.seq = seq;

    const added = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_REPAIRS], 'readwrite');
      const store = tx.objectStore(STORE_REPAIRS);
      const getReq = store.get(record.caseId);
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve(false); // 已存在，跳過
          return;
        }
        const addReq = store.add(record);
        addReq.onsuccess = () => resolve(true);
        addReq.onerror = () => resolve(false);
      };
      getReq.onerror = () => reject(getReq.error);
    });

    if (added) {
      importedCount += 1;
      if (seq > maxSeqSeen) maxSeqSeen = seq;
    } else {
      skippedDuplicates.push(record.caseId);
    }
  }

  // 如果匯入資料的編號比目前流水號更大，更新流水號（絕不減少）
  const payloadCounter = typeof payload.counter === 'number' ? payload.counter : 0;
  const candidateMax = Math.max(maxSeqSeen, payloadCounter);
  if (candidateMax > 0) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_COUNTER], 'readwrite');
      const store = tx.objectStore(STORE_COUNTER);
      const getReq = store.get(COUNTER_KEY);
      getReq.onsuccess = () => {
        const current = getReq.result ? getReq.result.value : 0;
        const next = Math.max(current, candidateMax);
        store.put({ id: COUNTER_KEY, value: next });
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  await reconcileCounter();

  const db2 = await openDB();
  const newCounter = await new Promise((resolve, reject) => {
    const tx = db2.transaction([STORE_COUNTER], 'readonly');
    const req = tx.objectStore(STORE_COUNTER).get(COUNTER_KEY);
    req.onsuccess = () => resolve(req.result ? req.result.value : 0);
    req.onerror = () => reject(req.error);
  });

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
