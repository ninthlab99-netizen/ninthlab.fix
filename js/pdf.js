/* ============================================================
 * pdf.js - 產生維修檢查確認表 PDF
 * 使用 jsPDF（CDN 載入，見各 html 的 <script> 標籤）
 * 版面：A4，直式，適合手機瀏覽、列印、以及 LINE 傳送。
 * ============================================================ */

const PDF_PAGE_W = 210;
const PDF_PAGE_H = 297;
const PDF_MARGIN = 12;
const PDF_CONTENT_W = PDF_PAGE_W - PDF_MARGIN * 2;

function pdfFileName(caseId) {
  return `${caseId}${PDF_FILENAME_SUFFIX}`;
}

function checkLabel(val) {
  if (val === '正常') return '✔ 正常';
  if (val === '異常') return '✘ 異常';
  if (val === '無法測試') return '－ 無法測試';
  if (val === '已有損傷' || val === '彎曲／變形') return '✘ ' + val;
  return val || '未檢查';
}

/**
 * @param {Object} repair 完整案件資料
 * @returns {Promise<{doc: any, blob: Blob, dataUrl: string, filename: string}>}
 */
async function generateRepairPDF(repair) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('PDF 產生元件尚未載入完成，請確認網路連線後重試。');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  let y = PDF_MARGIN;
  const lineGap = 6;

  function ensureSpace(need) {
    if (y + need > PDF_PAGE_H - PDF_MARGIN) {
      doc.addPage();
      y = PDF_MARGIN;
    }
  }

  function h1(text) {
    ensureSpace(10);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(text, PDF_MARGIN, y);
    y += 2;
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.6);
    doc.line(PDF_MARGIN, y, PDF_PAGE_W - PDF_MARGIN, y);
    y += 6;
  }

  function h2(text) {
    ensureSpace(8);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(37, 99, 235);
    doc.text(text, PDF_MARGIN, y);
    y += lineGap;
    doc.setTextColor(20, 20, 20);
  }

  function row(label, value) {
    ensureSpace(lineGap);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    doc.text(String(label), PDF_MARGIN, y);
    doc.setTextColor(20, 20, 20);
    doc.setFont(undefined, 'normal');
    const valueText = value === undefined || value === null || value === '' ? '—' : String(value);
    const lines = doc.splitTextToSize(valueText, PDF_CONTENT_W - 32);
    doc.text(lines, PDF_MARGIN + 32, y);
    y += lineGap * Math.max(1, lines.length);
  }

  function twoCol(items) {
    // items: [[label,value],[label,value]] 一行放兩組
    const colW = PDF_CONTENT_W / 2;
    for (let i = 0; i < items.length; i += 2) {
      ensureSpace(lineGap);
      doc.setFontSize(9.3);
      const [l1, v1] = items[i];
      doc.setTextColor(90, 90, 90);
      doc.text(String(l1), PDF_MARGIN, y);
      doc.setTextColor(20, 20, 20);
      doc.text(String(v1 == null || v1 === '' ? '—' : v1), PDF_MARGIN + 24, y);
      if (items[i + 1]) {
        const [l2, v2] = items[i + 1];
        doc.setTextColor(90, 90, 90);
        doc.text(String(l2), PDF_MARGIN + colW, y);
        doc.setTextColor(20, 20, 20);
        doc.text(String(v2 == null || v2 === '' ? '—' : v2), PDF_MARGIN + colW + 24, y);
      }
      y += lineGap;
    }
  }

  function paragraph(text) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(String(text || '—'), PDF_CONTENT_W);
    ensureSpace(lineGap * lines.length);
    doc.text(lines, PDF_MARGIN, y);
    y += lineGap * lines.length;
  }

  async function photoRow(labelsAndData) {
    // labelsAndData: [{label, dataUrl}, ...] 最多 4 張，一行排開
    const valid = labelsAndData.filter((x) => x.dataUrl);
    if (!valid.length) {
      paragraph('（無照片）');
      return;
    }
    const gap = 3;
    const cols = Math.min(valid.length, 4);
    const boxW = (PDF_CONTENT_W - gap * (cols - 1)) / cols;
    const boxH = boxW * 0.78;
    ensureSpace(boxH + 8);
    let x = PDF_MARGIN;
    for (let i = 0; i < valid.length; i++) {
      if (i > 0 && i % 4 === 0) {
        y += boxH + 8;
        ensureSpace(boxH + 8);
        x = PDF_MARGIN;
      }
      try {
        const fmt = valid[i].dataUrl.indexOf('image/png') !== -1 ? 'PNG' : 'JPEG';
        doc.addImage(valid[i].dataUrl, fmt, x, y, boxW, boxH, undefined, 'FAST');
      } catch (e) { /* 忽略單張圖片錯誤，避免整份 PDF 失敗 */ }
      doc.setFontSize(7.5);
      doc.setTextColor(110, 110, 110);
      doc.text(valid[i].label, x, y + boxH + 3.5);
      x += boxW + gap;
    }
    y += boxH + 9;
  }

  async function signatureBlock(label, dataUrl) {
    ensureSpace(28);
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    doc.text(label, PDF_MARGIN, y);
    y += 3;
    doc.setDrawColor(200, 200, 200);
    doc.rect(PDF_MARGIN, y, 80, 24);
    if (dataUrl) {
      try { doc.addImage(dataUrl, 'PNG', PDF_MARGIN + 1, y + 1, 78, 22, undefined, 'FAST'); } catch (e) {}
    }
    y += 24 + 6;
  }

  /* ---------- 標題區 ---------- */
  doc.setFont(undefined, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 15, 15);
  doc.text(BRAND_NAME, PDF_MARGIN, y);
  y += 6.5;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text(BRAND_SUBTITLE, PDF_MARGIN, y);

  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(37, 99, 235);
  doc.text(repair.caseId, PDF_PAGE_W - PDF_MARGIN, y - 3, { align: 'right' });
  y += 6;
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.8);
  doc.line(PDF_MARGIN, y, PDF_PAGE_W - PDF_MARGIN, y);
  y += 7;

  /* ---------- 基本資料 ---------- */
  h2('基本資料');
  twoCol([
    ['案件編號', repair.caseId],
    ['技師', repair.basic.technician],
    ['建立時間', formatDateTime(repair.createdAt)],
    ['完成時間', repair.completedAt ? formatDateTime(repair.completedAt) : '—'],
    ['客戶姓名', repair.basic.customerName],
    ['聯絡方式', repair.basic.contact],
    ['手機型號', repair.basic.phoneModel],
    ['案件狀態', statusLabel(repair.status)],
  ]);
  y += 2;

  /* ---------- 維修前外觀檢查 ---------- */
  h1('維修前外觀檢查');
  const ap = repair.preCheck.appearance;
  twoCol([
    ['螢幕', ap.screen], ['背板', ap.back],
    ['邊框', ap.frame], ['鏡頭玻璃', ap.cameraGlass],
    ['機身', ap.body], ['', ''],
  ]);
  const dmg = repair.preCheck.existingDamage;
  const dmgList = [];
  if (dmg.none) dmgList.push('無');
  if (dmg.screenCrack) dmgList.push('螢幕裂痕');
  if (dmg.backCrack) dmgList.push('背板裂痕');
  if (dmg.frameDent) dmgList.push('邊框凹傷');
  if (dmg.cameraBroken) dmgList.push('鏡頭破損');
  if (dmg.bodyDeformed) dmgList.push('機身變形');
  if (dmg.other) dmgList.push('其他：' + (dmg.otherText || ''));
  row('既有損傷', dmgList.join('、') || '無');
  y += 2;

  /* ---------- 維修前功能檢查 ---------- */
  h2('維修前功能檢查');
  const fc = repair.preCheck.functionCheck;
  const fcLabels = {
    powerOn: '開機', screenTouch: '螢幕／觸控', cameras: '前後鏡頭',
    faceId: 'Face ID／生物辨識', speakerMic: '喇叭／麥克風',
    charging: '充電', flashlight: '手電筒', buttons: '按鍵',
  };
  Object.keys(fcLabels).forEach((k) => {
    const item = fc[k] || {};
    row(fcLabels[k], checkLabel(item.status) + (item.note ? `（備註：${item.note}）` : ''));
  });
  if (repair.preCheck.otherFault && repair.preCheck.otherFault.has) {
    row('其他原有故障', repair.preCheck.otherFault.text || '—');
  }
  y += 2;

  /* ---------- 維修內容 ---------- */
  h1('本次維修項目');
  const items = repair.repairContent.items || {};
  const itemLabels = {
    battery: '電池更換', screen: '螢幕更換', camera: '鏡頭更換',
    speaker: '喇叭／聽筒', chargingPort: '充電／尾插',
  };
  const chosenItems = Object.keys(itemLabels).filter((k) => items[k]).map((k) => itemLabels[k]);
  if (items.other) chosenItems.push('其他：' + (items.otherText || ''));
  row('維修項目', chosenItems.join('、') || '—');
  row('維修金額', repair.repairContent.price ? `NT$ ${repair.repairContent.price}` : '—');
  const partLabels = { original: '原廠', originalUsed: '原廠拆機', aftermarket: '副廠', other: '其他' };
  row('零件類型', (partLabels[repair.repairContent.partType] || '—') +
    (repair.repairContent.partType === 'other' && repair.repairContent.partTypeOtherText ? `（${repair.repairContent.partTypeOtherText}）` : ''));
  y += 2;

  /* ---------- 維修前照片 ---------- */
  h2('維修前照片');
  await photoRow([
    { label: '手機正面', dataUrl: repair.prePhotos.front },
    { label: '手機背面', dataUrl: repair.prePhotos.back },
    { label: '維修部位', dataUrl: repair.prePhotos.repairArea },
    { label: '明顯損傷', dataUrl: repair.prePhotos.damage },
  ]);

  /* ---------- 維修完成檢查 ---------- */
  h1('維修完成檢查');
  const pc = repair.postCheck.items || {};
  const pcLabels = {
    powerOn: '可正常開機', screenTouch: '螢幕／觸控正常', repairFunction: '本次維修功能正常',
    camera: '相機正常', faceId: 'Face ID／生物辨識正常', charging: '充電正常',
    noOverheat: '無異常發熱／異味', noNewDamage: '外觀無新增損傷',
  };
  Object.keys(pcLabels).forEach((k) => {
    row(pcLabels[k], checkLabel(pc[k]));
  });
  const postAbn = repair.postCheck.abnormal || {};
  row('維修後異常／備註', postAbn.has ? (postAbn.text || '—') : '無');
  y += 2;

  /* ---------- 維修完成照片 ---------- */
  h2('維修完成照片');
  await photoRow([
    { label: '手機正面', dataUrl: repair.postPhotos.front },
    { label: '手機背面', dataUrl: repair.postPhotos.back },
    { label: '維修部位', dataUrl: repair.postPhotos.repairArea },
  ]);

  /* ---------- 客戶確認 ---------- */
  h1('客戶確認');
  const cc = repair.customerConfirm || {};
  const ccTexts = [
    '維修前手機狀況已確認。',
    '本次維修項目及價格已確認。',
    '維修完成後已由技師進行檢查。',
    '本人已確認目前手機狀況。',
    '如有未完成或無法測試之項目，技師已向本人說明。',
  ];
  ['item1', 'item2', 'item3', 'item4', 'item5'].forEach((k, idx) => {
    row(cc[k] ? '☑' : '☐', ccTexts[idx]);
  });
  y += 2;

  /* ---------- 簽名 ---------- */
  h2('簽名');
  await signatureBlock('客戶簽名', repair.signatures.customer);
  await signatureBlock('技師簽名', repair.signatures.technician);

  /* ---------- 頁尾 ---------- */
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`${repair.caseId}　${BRAND_NAME}　第 ${p}／${pageCount} 頁`, PDF_PAGE_W / 2, PDF_PAGE_H - 6, { align: 'center' });
  }

  const blob = doc.output('blob');
  const dataUrl = doc.output('datauristring');
  return { doc, blob, dataUrl, filename: pdfFileName(repair.caseId) };
}
