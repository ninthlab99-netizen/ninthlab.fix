/* ============================================================
 * signature.js - 手寫簽名板
 * 支援：手機手指、平板觸控筆、滑鼠（統一使用 Pointer Events）
 * 白底黑字，提供 clear()／isEmpty()／toDataURL()
 * ============================================================ */

class SignaturePad {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drawing = false;
    this.hasInk = false;
    this.lastPoint = null;
    this.strokes = []; // 記錄筆劃，resize 時可重繪

    this._resizeToDisplaySize();
    this._bindEvents();
    window.addEventListener('resize', () => this._resizeToDisplaySize(true));
    window.addEventListener('orientationchange', () => this._resizeToDisplaySize(true));
  }

  _resizeToDisplaySize(keepContent) {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const newW = Math.round(rect.width * ratio);
    const newH = Math.round(rect.height * ratio);
    if (canvas.width === newW && canvas.height === newH) return;
    canvas.width = newW;
    canvas.height = newH;
    this.ctx.scale(ratio, ratio);
    this._paintBackground();
    if (keepContent && this.strokes.length) {
      this._redrawStrokes();
    } else {
      this.strokes = [];
      this.hasInk = false;
    }
  }

  _paintBackground() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.save();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, rect.width || this.canvas.width, rect.height || this.canvas.height);
    this.ctx.restore();
  }

  _redrawStrokes() {
    this.ctx.save();
    this.ctx.lineWidth = 2.6;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#111111';
    for (const stroke of this.strokes) {
      if (stroke.length < 2) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) {
        this.ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();
    this.hasInk = this.strokes.some((s) => s.length > 1);
  }

  _getPoint(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    };
  }

  _bindEvents() {
    const canvas = this.canvas;
    canvas.style.touchAction = 'none'; // 避免簽名時頁面被滑動

    const onDown = (evt) => {
      evt.preventDefault();
      this.drawing = true;
      const p = this._getPoint(evt);
      this.lastPoint = p;
      this.currentStroke = [p];
      this.strokes.push(this.currentStroke);
      canvas.setPointerCapture && evt.pointerId != null && canvas.setPointerCapture(evt.pointerId);
    };

    const onMove = (evt) => {
      if (!this.drawing) return;
      evt.preventDefault();
      const p = this._getPoint(evt);
      this.ctx.save();
      this.ctx.lineWidth = 2.6;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = '#111111';
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
      this.ctx.restore();
      this.lastPoint = p;
      this.currentStroke.push(p);
      this.hasInk = true;
    };

    const onUp = (evt) => {
      this.drawing = false;
      this.lastPoint = null;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);
  }

  clear() {
    this.strokes = [];
    this.hasInk = false;
    this._paintBackground();
  }

  isEmpty() {
    return !this.hasInk;
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}
