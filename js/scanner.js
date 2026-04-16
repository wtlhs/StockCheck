'use strict';

const Scanner = {
  _scanner: null,
  _isRunning: false,
  _lastCode: null,
  _lastTime: 0,
  _debounceMs: 1500,
  _containerId: null,

  /**
   * 创建扫描聚焦框覆盖层
   */
  _createOverlay(container) {
    var existing = container.querySelector('.scan-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';

    const frame = document.createElement('div');
    frame.className = 'scan-frame';

    ['tl', 'tr', 'bl', 'br'].forEach(function(pos) {
      const corner = document.createElement('span');
      corner.className = 'scan-corner scan-corner-' + pos;
      frame.appendChild(corner);
    });

    const line = document.createElement('div');
    line.className = 'scan-line';
    frame.appendChild(line);

    overlay.appendChild(frame);
    container.appendChild(overlay);
  },

  /**
   * 移除覆盖层
   */
  _removeOverlay() {
    const container = document.getElementById(this._containerId);
    if (!container) return;
    const overlay = container.querySelector('.scan-overlay');
    if (overlay) overlay.remove();
  },

  _getScannerFormats() {
    if (typeof Html5QrcodeSupportedFormats === 'undefined') {
      return null;
    }

    return [Html5QrcodeSupportedFormats.CODE_128];
  },

  _rememberScan(code, now) {
    this._lastCode = code;
    this._lastTime = now;
  },

  _isDuplicate(code, now) {
    return code === this._lastCode && (now - this._lastTime) < this._debounceMs;
  },

  /**
   * 确保 Html5Qrcode 实例存在（同一容器只创建一次）
   */
  _ensureScanner(containerId) {
    if (this._scanner) return this._scanner;

    if (typeof Html5Qrcode !== 'function') {
      return null;
    }

    const formats = this._getScannerFormats();
    this._scanner = new Html5Qrcode(containerId, formats && formats.length ? {
      formatsToSupport: formats
    } : undefined);
    return this._scanner;
  },

  /**
   * 启动摄像头扫描
   */
  async start(containerId, onSuccess) {
    this._containerId = containerId;

    if (this._isRunning) {
      await this._pause();
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    const scanner = this._ensureScanner(containerId);
    if (!scanner) {
      App.showToast('条码扫描库加载失败', true);
      return;
    }

    var camConfig = { facingMode: 'environment' };
    var scanConfig = {
      fps: 15,
      aspectRatio: 1.0,
      disableFlip: true,
      qrbox: function(viewfinderWidth, viewfinderHeight) {
        var min = Math.min(viewfinderWidth, viewfinderHeight);
        var size = Math.floor(min * 0.85);
        return { width: size, height: Math.floor(size * 0.55) };
      }
    };
    var onSuccessCallback = (decodedText) => this._onScanSuccess(decodedText, onSuccess);
    var onError = function() {};

    try {
      await scanner.start(camConfig, scanConfig, onSuccessCallback, onError);
    } catch (firstErr) {
      console.warn('[Scanner] 后置摄像头启动失败，尝试任意摄像头:', firstErr);
      try {
        await scanner.stop();
      } catch (_) { /* ignore */ }

      try {
        await scanner.start(true, scanConfig, onSuccessCallback, onError);
      } catch (secondErr) {
        console.error('[Scanner] 所有摄像头配置均失败:', secondErr);
        var detail = '';
        if (firstErr) detail = firstErr.message || firstErr.toString();
        var msg = '摄像头启动失败';
        if (detail) msg += '：' + detail;
        App.showToast(msg, true);
        return;
      }
    }

    this._isRunning = true;
    this._createOverlay(container);
  },

  /**
   * 暂停扫描（不销毁实例，可 resume）
   */
  async _pause() {
    this._isRunning = false;
    if (!this._scanner) return;

    try {
      if (typeof this._scanner.isScanning === 'function' ? this._scanner.isScanning() : this._scanner.isScanning) {
        await this._scanner.stop();
      }
    } catch (_) { /* ignore */ }

    this._removeOverlay();
  },

  /**
   * 停止扫描并销毁实例
   */
  async stop() {
    this._isRunning = false;

    const scanner = this._scanner;
    this._scanner = null;

    if (scanner) {
      try {
        if (typeof scanner.isScanning === 'function' ? scanner.isScanning() : scanner.isScanning) {
          await scanner.stop();
        }
      } catch (_) { /* ignore */ }

      try {
        await scanner.clear();
      } catch (_) { /* ignore */ }
    }

    this._removeOverlay();

    if (this._containerId) {
      const container = document.getElementById(this._containerId);
      if (container) container.innerHTML = '';
    }
  },

  _onScanSuccess(decodedText, onSuccess) {
    if (!this._isRunning || typeof decodedText !== 'string') return;

    const rawText = decodedText.trim();
    if (!rawText) return;

    const now = Date.now();
    if (this._isDuplicate(rawText, now)) {
      return;
    }
    this._rememberScan(rawText, now);

    const normalizedCode = Utils.normalizeBarcode(rawText);
    if (!normalizedCode) {
      App.showToast('不是目标条码，请继续扫描正确条形码');
      Utils.vibrate(60);
      return;
    }

    Utils.vibrate(180);

    this._pause().then(() => {
      if (typeof onSuccess === 'function') {
        onSuccess(normalizedCode, rawText);
      }
    });
  }
};
