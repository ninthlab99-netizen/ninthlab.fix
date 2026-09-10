/* ============================================================
 * pdf.js - 產生維修檢查確認表 PDF
 *
 * 做法：先把報表內容畫成一段 HTML（用瀏覽器原生字型渲染），
 * 用 html2canvas 把這段 HTML 轉成圖片，再用 jsPDF 把圖片切成
 * A4 分頁貼進 PDF。
 *
 * 為什麼不直接用 jsPDF 的 doc.text() 畫中文？
 * 因為 jsPDF 內建字型（Helvetica 等）只有英文字母字型，
 * 不含中文字型對照表，直接畫中文字會變成亂碼符號。
 * 改成先讓瀏覽器把中文用手機/電腦本身就有的字型渲染成圖片，
 * 再放進 PDF，就不會有亂碼問題，也不需要另外下載、內嵌一份
 * 很大的中文字型檔。
 *
 * 使用 jsPDF + html2canvas（皆透過 CDN 載入，見各 html 的 <script> 標籤）
 * 版面：A4，直式，適合手機瀏覽、列印、以及 LINE 傳送。
 * ============================================================ */

const PDF_PAGE_W = 210; // mm
const PDF_PAGE_H = 297; // mm
const PDF_RENDER_WIDTH_PX = 794; // ≈ A4 寬度 @ 96dpi，報表 HTML 用這個寬度繪製
const PDF_RENDER_SCALE = 2; // html2canvas 放大倍率，讓文字與照片更清晰
const PDF_MARGIN_PX = 40;
const PDF_CONTENT_W_PX = PDF_RENDER_WIDTH_PX - PDF_MARGIN_PX * 2;
const PDF_FONT_STACK = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans TC", "Segoe UI", Roboto, sans-serif';

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

function escapeHtml(str) {
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- HTML 版面小工具（純字串拼接，最後一次塞進 innerHTML） ---------- */

function h1Html(text) {
  return `<div style="font-size:16px;font-weight:700;color:#141414;margin:18px 0 8px;padding-bottom:5px;border-bottom:2.5px solid #2563eb;">${escapeHtml(text)}</div>`;
}

function h2Html(text) {
  return `<div style="font-size:13px;font-weight:700;color:#2563eb;margin:12px 0 6px;">${escapeHtml(text)}</div>`;
}

function rowHtml(label, value) {
  const v = (value === undefined || value === null || value === '') ? '—' : value;
  return `<div style="display:flex;padding:5px 0;border-bottom:1px solid #eee;font-size:11.5px;line-height:1.5;">
    <div style="width:120px;flex:none;color:#5a5a5a;">${escapeHtml(label)}</div>
    <div style="flex:1;color:#141414;white-space:pre-wrap;word-break:break-word;">${escapeHtml(v)}</div>
  </div>`;
}

function twoColHtml(items) {
  // items: [[label, value], [label, value], ...] 兩組排一行
  let out = '<div>';
  for (let i = 0; i < items.length; i += 2) {
    out += '<div style="display:flex;padding:5px 0;border-bottom:1px solid #eee;font-size:11.5px;line-height:1.5;">';
    [items[i], items[i + 1]].forEach((pairItem) => {
      if (!pairItem || pairItem[0] === '') {
        out += '<div style="flex:1;"></div>';
        return;
      }
      const [l, v] = pairItem;
      const val = (v === undefined || v === null || v === '') ? '—' : v;
      out += `<div style="flex:1;display:flex;">
        <div style="width:96px;flex:none;color:#5a5a5a;">${escapeHtml(l)}</div>
        <div style="flex:1;color:#141414;">${escapeHtml(val)}</div>
      </div>`;
    });
    out += '</div>';
  }
  out += '</div>';
  return out;
}

function photoRowHtml(labelsAndData) {
  const valid = labelsAndData.filter((x) => x.dataUrl);
  if (!valid.length) {
    return '<div style="font-size:11.5px;color:#999;padding:6px 0;">（無照片）</div>';
  }
  const cols = Math.min(valid.length, 4);
  const gap = 8;
  const boxW = Math.floor((PDF_CONTENT_W_PX - gap * (cols - 1)) / cols);
  const boxH = Math.floor(boxW * 0.78);
  let out = '<div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;">';
  valid.forEach((item) => {
    out += `<div style="width:${boxW}px;">
      <img src="${item.dataUrl}" style="width:${boxW}px;height:${boxH}px;object-fit:cover;border-radius:4px;border:1px solid #ddd;display:block;" />
      <div style="font-size:9.5px;color:#6e6e6e;margin-top:3px;">${escapeHtml(item.label)}</div>
    </div>`;
  });
  out += '</div>';
  return out;
}

function signatureBlockHtml(label, dataUrl) {
  return `<div style="margin:8px 0;">
    <div style="font-size:11.5px;color:#5a5a5a;margin-bottom:4px;">${escapeHtml(label)}</div>
    <div style="width:300px;height:90px;border:1px solid #ccc;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff;">
      ${dataUrl ? `<img src="${dataUrl}" style="max-width:100%;max-height:100%;" />` : '<span style="color:#bbb;font-size:11px;">未簽名</span>'}
    </div>
  </div>`;
}

async function waitForImages(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));
}

function buildRepairReportHtml(repair) {
  const ap = repair.preCheck.appearance;
  const dmg = repair.preCheck.existingDamage;
  const dmgList = [];
  if (dmg.none) dmgList.push('無');
  if (dmg.screenCrack) dmgList.push('螢幕裂痕');
  if (dmg.backCrack) dmgList.push('背板裂痕');
  if (dmg.frameDent) dmgList.push('邊框凹傷');
  if (dmg.cameraBroken) dmgList.push('鏡頭破損');
  if (dmg.bodyDeformed) dmgList.push('機身變形');
  if (dmg.other) dmgList.push('其他：' + (dmg.otherText || ''));

  const fc = repair.preCheck.functionCheck;
  const fcLabels = {
    powerOn: '開機', screenTouch: '螢幕／觸控', cameras: '前後鏡頭',
    faceId: 'Face ID／生物辨識', speakerMic: '喇叭／麥克風',
    charging: '充電', flashlight: '手電筒', buttons: '按鍵',
  };

  const items = repair.repairContent.items || {};
  const itemLabels = {
    battery: '電池更換', screen: '螢幕更換', camera: '鏡頭更換',
    speaker: '喇叭／聽筒', chargingPort: '充電／尾插',
  };
  const chosenItems = Object.keys(itemLabels).filter((k) => items[k]).map((k) => itemLabels[k]);
  if (items.other) chosenItems.push('其他：' + (items.otherText || ''));
  const partLabels = { original: '原廠', originalUsed: '原廠拆機', aftermarket: '副廠', other: '其他' };

  const pc = repair.postCheck.items || {};
  const pcLabels = {
    powerOn: '可正常開機', screenTouch: '螢幕／觸控正常', repairFunction: '本次維修功能正常',
    camera: '相機正常', faceId: 'Face ID／生物辨識正常', charging: '充電正常',
    noOverheat: '無異常發熱／異味', noNewDamage: '外觀無新增損傷',
  };
  const postAbn = repair.postCheck.abnormal || {};

  const cc = repair.customerConfirm || {};
  const ccTexts = [
    '維修前手機狀況已確認。',
    '本次維修項目及價格已確認。',
    '維修完成後已由技師進行檢查。',
    '本人已確認目前手機狀況。',
    '如有未完成或無法測試之項目，技師已向本人說明。',
  ];

  let html = '';
  html += `<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #141414;padding-bottom:10px;margin-bottom:10px;">
    <div>
      <div style="font-size:22px;font-weight:800;color:#0f0f0f;">${escapeHtml(BRAND_NAME)}</div>
      <div style="font-size:14px;color:#3c3c3c;margin-top:2px;">${escapeHtml(BRAND_SUBTITLE)}</div>
    </div>
    <div style="font-size:17px;font-weight:800;color:#2563eb;">${escapeHtml(repair.caseId)}</div>
  </div>`;

  html += h2Html('基本資料');
  html += twoColHtml([
    ['案件編號', repair.caseId],
    ['技師', repair.basic.technician],
    ['建立時間', formatDateTime(repair.createdAt)],
    ['完成時間', repair.completedAt ? formatDateTime(repair.completedAt) : '—'],
    ['客戶姓名', repair.basic.customerName],
    ['聯絡方式', repair.basic.contact],
    ['手機型號', repair.basic.phoneModel],
    ['案件狀態', statusLabel(repair.status)],
  ]);

  html += h1Html('維修前外觀檢查');
  html += twoColHtml([
    ['螢幕', ap.screen], ['背板', ap.back],
    ['邊框', ap.frame], ['鏡頭玻璃', ap.cameraGlass],
    ['機身', ap.body], ['', ''],
  ]);
  html += rowHtml('既有損傷', dmgList.join('、') || '無');

  html += h2Html('維修前功能檢查');
  Object.keys(fcLabels).forEach((k) => {
    const item = fc[k] || {};
    html += rowHtml(fcLabels[k], checkLabel(item.status) + (item.note ? `（備註：${item.note}）` : ''));
  });
  if (repair.preCheck.otherFault && repair.preCheck.otherFault.has) {
    html += rowHtml('其他原有故障', repair.preCheck.otherFault.text || '—');
  }

  html += h1Html('本次維修項目');
  html += rowHtml('維修項目', chosenItems.join('、') || '—');
  html += rowHtml('維修金額', repair.repairContent.price ? `NT$ ${repair.repairContent.price}` : '—');
  html += rowHtml('零件類型', (partLabels[repair.repairContent.partType] || '—') +
    (repair.repairContent.partType === 'other' && repair.repairContent.partTypeOtherText ? `（${repair.repairContent.partTypeOtherText}）` : ''));

  html += h2Html('維修前照片');
  html += photoRowHtml([
    { label: '手機正面', dataUrl: repair.prePhotos.front },
    { label: '手機背面', dataUrl: repair.prePhotos.back },
    { label: '維修部位', dataUrl: repair.prePhotos.repairArea },
    { label: '明顯損傷', dataUrl: repair.prePhotos.damage },
  ]);

  html += h1Html('維修完成檢查');
  Object.keys(pcLabels).forEach((k) => {
    html += rowHtml(pcLabels[k], checkLabel(pc[k]));
  });
  html += rowHtml('維修後異常／備註', postAbn.has ? (postAbn.text || '—') : '無');

  html += h2Html('維修完成照片');
  html += photoRowHtml([
    { label: '手機正面', dataUrl: repair.postPhotos.front },
    { label: '手機背面', dataUrl: repair.postPhotos.back },
    { label: '維修部位', dataUrl: repair.postPhotos.repairArea },
  ]);

  html += h1Html('客戶確認');
  ['item1', 'item2', 'item3', 'item4', 'item5'].forEach((k, idx) => {
    html += rowHtml(cc[k] ? '☑' : '☐', ccTexts[idx]);
  });

  html += h2Html('簽名');
  html += `<div style="display:flex;gap:24px;flex-wrap:wrap;">
    ${signatureBlockHtml('客戶簽名', repair.signatures.customer)}
    ${signatureBlockHtml('技師簽名', repair.signatures.technician)}
  </div>`;

  html += `<div style="margin-top:16px;padding-top:8px;border-top:1px solid #ddd;font-size:9.5px;color:#999;text-align:center;">
    ${escapeHtml(repair.caseId)} ・ ${escapeHtml(BRAND_NAME)}
  </div>`;

  return html;
}

/**
 * @param {Object} repair 完整案件資料
 * @returns {Promise<{doc: any, blob: Blob, dataUrl: string, filename: string}>}
 */
async function generateRepairPDF(repair) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('PDF 產生元件尚未載入完成，請確認網路連線後重試。');
  }
  if (!window.html2canvas) {
    throw new Error('PDF 圖片繪製元件尚未載入完成，請確認網路連線後重試。');
  }
  const { jsPDF } = window.jspdf;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '-99999px';
  container.style.width = PDF_RENDER_WIDTH_PX + 'px';
  container.style.padding = PDF_MARGIN_PX + 'px';
  container.style.background = '#ffffff';
  container.style.boxSizing = 'border-box';
  container.style.fontFamily = PDF_FONT_STACK;
  container.style.color = '#141414';
  container.innerHTML = buildRepairReportHtml(repair);
  document.body.appendChild(container);

  let blob;
  let dataUrl;
  let doc;
  try {
    await waitForImages(container);
    const canvas = await window.html2canvas(container, {
      scale: PDF_RENDER_SCALE,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: PDF_RENDER_WIDTH_PX,
    });

    doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWpx = canvas.width;
    const pageHpx = Math.floor(pageWpx * (PDF_PAGE_H / PDF_PAGE_W));
    const totalH = canvas.height;
    let renderedH = 0;
    let first = true;
    while (renderedH < totalH) {
      const sliceH = Math.min(pageHpx, totalH - renderedH);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = pageWpx;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, renderedH, pageWpx, sliceH, 0, 0, pageWpx, sliceH);
      const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
      if (!first) doc.addPage();
      const imgHmm = (sliceH / pageWpx) * PDF_PAGE_W;
      doc.addImage(imgData, 'JPEG', 0, 0, PDF_PAGE_W, imgHmm);
      renderedH += sliceH;
      first = false;
    }

    blob = doc.output('blob');
    dataUrl = doc.output('datauristring');
  } finally {
    container.remove();
  }

  return { doc, blob, dataUrl, filename: pdfFileName(repair.caseId) };
}
