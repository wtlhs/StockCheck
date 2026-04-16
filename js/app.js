'use strict';

const App = {
  VERSION: '20260416-04',
  currentPage: 'page-home',
  _toastTimer: null,
  _indexData: null,
  _shippedOutCodeSet: new Set(),
  _shippedOutPlainSet: new Set(),
  _inStockCodeSet: new Set(),
  _inStockPlainSet: new Set(),
  _inStockMap: {},
  _partTrayMap: {},
  _recentInspections: [],
  _isDataReady: false,

  showPage(pageId) {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (!target) return;
    target.classList.add('active');
    this.currentPage = pageId;
  },

  showToast(message, isError = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast' + (isError ? ' error' : '');
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  },

  async init() {
    document.getElementById('footer-version').textContent = 'v' + this.VERSION;
    await DB.open();
    this._registerServiceWorker();
    this._bindEvents();
    this.renderHomeLoading();
    this.renderResultCard(this._buildIdleResult());
    await this._loadInitialData();
  },

  async _loadInitialData() {
    await Promise.all([
      this._loadOutboundIndex(),
      this._loadRecentInspections()
    ]);
  },

  renderHomeLoading() {
    const cardEl = document.getElementById('data-status-card');
    const titleEl = document.getElementById('data-status-title');
    const descEl = document.getElementById('data-status-desc');
    const iconEl = document.getElementById('data-status-icon');
    if (cardEl) cardEl.className = 'data-status-card status-loading';
    if (titleEl) titleEl.textContent = '正在加载基础数据';
    if (descEl) descEl.textContent = '请稍候，正在读取 outbound-index.json';
    if (iconEl) iconEl.innerHTML = '&#9203;';
  },

  renderHomeStatus() {
    const cardEl = document.getElementById('data-status-card');
    const titleEl = document.getElementById('data-status-title');
    const descEl = document.getElementById('data-status-desc');
    const iconEl = document.getElementById('data-status-icon');

    if (!this._isDataReady || !this._indexData) {
      if (cardEl) cardEl.className = 'data-status-card status-error';
      if (titleEl) titleEl.textContent = '基础数据加载失败';
      if (descEl) descEl.textContent = '请检查 docs/outbound-index.json 是否存在且内容有效';
      if (iconEl) iconEl.innerHTML = '&#9888;';
      return;
    }

    if (cardEl) cardEl.className = 'data-status-card status-ready';
    if (titleEl) titleEl.textContent = '基础数据已加载';
    if (descEl) {
      const shipped = this._indexData.shippedOut ? this._indexData.shippedOut.count : 0;
      const inStock = this._indexData.inStock ? this._indexData.inStock.invoiceCount : 0;
      descEl.innerHTML =
        '来源：' + Utils.esc(this._indexData.source || '-') + '<br>' +
        '已出库：' + Utils.esc(String(shipped)) + ' 票<br>' +
        '在库：' + Utils.esc(String(inStock)) + ' 票<br>' +
        '版本：' + Utils.esc(this._indexData.version || '-');
    }
    if (iconEl) iconEl.innerHTML = '&#128230;';
  },

  _buildIdleResult() {
    return {
      badge: '等待扫码',
      title: '请将条形码放入取景框内',
      message: this._isDataReady
        ? '命中已出库清单将触发红色警示，未命中将显示绿色正常提示。'
        : '基础数据未就绪，暂时无法进行抽检判定。',
      className: 'result-idle'
    };
  },

  renderResultCard(result) {
    const resultArea = document.getElementById('inspection-result-area');
    if (!resultArea) return;

    resultArea.innerHTML =
      '<div class="inspection-result-card ' + Utils.esc(result.className || 'result-idle') + '">' +
        '<div class="inspection-result-badge">' + Utils.esc(result.badge) + '</div>' +
        '<div class="inspection-result-title">' + Utils.esc(result.title) + '</div>' +
        '<div class="inspection-result-message">' + result.message + '</div>' +
      '</div>';
  },

  async _loadOutboundIndex() {
    try {
      const response = await fetch('docs/outbound-index.json?_v=' + encodeURIComponent(this.VERSION), {
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const data = await response.json();
      this._validateIndexData(data);
      this._indexData = {
        version: String(data.version),
        source: String(data.source),
        shippedOut: data.shippedOut ? {
          count: data.shippedOut.count,
          codes: data.shippedOut.codes.slice(),
          plainCodes: data.shippedOut.plainCodes.slice()
        } : null,
        inStock: data.inStock ? {
          invoiceCount: data.inStock.invoiceCount,
          items: data.inStock.items,
          plainCodes: data.inStock.plainCodes.slice()
        } : null
      };
      this._shippedOutCodeSet = this._indexData.shippedOut
        ? new Set(this._indexData.shippedOut.codes)
        : new Set();
      this._shippedOutPlainSet = this._indexData.shippedOut
        ? new Set(this._indexData.shippedOut.plainCodes)
        : new Set();
      this._inStockCodeSet = this._indexData.inStock
        ? new Set(Object.keys(this._indexData.inStock.items))
        : new Set();
      this._inStockPlainSet = this._indexData.inStock
        ? new Set(this._indexData.inStock.plainCodes)
        : new Set();
      this._inStockMap = this._indexData.inStock
        ? this._indexData.inStock.items
        : {};
      this._partTrayMap = (data.partTrayMap && typeof data.partTrayMap === 'object')
        ? data.partTrayMap
        : {};
      this._isDataReady = true;
      this.renderHomeStatus();
    } catch (error) {
      this._indexData = null;
      this._shippedOutCodeSet = new Set();
      this._shippedOutPlainSet = new Set();
      this._inStockCodeSet = new Set();
      this._inStockPlainSet = new Set();
      this._inStockMap = {};
      this._partTrayMap = {};
      this._isDataReady = false;
      this.renderHomeStatus();
      this.showToast('基础数据加载失败', true);
    }
  },

  _validateIndexData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('索引文件格式错误');
    }

    // 兼容旧版格式
    if (data.codes && Array.isArray(data.codes)) {
      if (!Array.isArray(data.plainCodes)) {
        throw new Error('索引文件缺少数组字段');
      }
      return;
    }

    // 新版格式验证
    const shipped = data.shippedOut;
    if (shipped) {
      if (!Array.isArray(shipped.codes) || !Array.isArray(shipped.plainCodes)) {
        throw new Error('shippedOut 缺少数组字段');
      }
      if (shipped.codes.length !== shipped.count || shipped.plainCodes.length !== shipped.count) {
        throw new Error('shippedOut 条数不一致');
      }
    }

    const inStock = data.inStock;
    if (inStock) {
      if (typeof inStock.items !== 'object' || Array.isArray(inStock.items)) {
        throw new Error('inStock.items 格式错误');
      }
      const keys = Object.keys(inStock.items);
      if (keys.length !== inStock.invoiceCount) {
        throw new Error('inStock 票数不一致');
      }
    }

    if (!shipped && !inStock) {
      throw new Error('索引文件缺少 shippedOut 和 inStock 数据');
    }
  },

  async _loadRecentInspections() {
    try {
      const items = await DB.getRecentInspections(10);
      this._recentInspections = items.slice();
    } catch (error) {
      this._recentInspections = [];
    }
    this.renderRecentInspections();
  },

  renderRecentInspections() {
    const recentArea = document.getElementById('recent-inspections');
    if (!recentArea) return;

    if (!this._recentInspections.length) {
      recentArea.innerHTML =
        '<div class="recent-section">' +
          '<div class="section-title">最近记录</div>' +
          '<div class="recent-empty">暂无抽检记录</div>' +
        '</div>';
      return;
    }

    const itemsHtml = this._recentInspections.map((item) => {
      const labelMap = {
        warning: '异常',
        normal: '正常',
        invalid: '无效'
      };
      return (
        '<div class="inspection-result-card recent-record-item ' + Utils.esc(item.result || 'result-idle') + '">' +
          '<div class="inspection-result-badge">' + Utils.esc(labelMap[item.result] || '记录') + '</div>' +
          '<div class="inspection-result-title">' + Utils.esc(item.normalizedCode || item.rawCode || '-') + '</div>' +
          '<div class="inspection-result-message">' +
            '时间：' + Utils.esc(Utils.formatDate(item.scannedAt)) + '<br>' +
            Utils.esc(item.message || '-') +
          '</div>' +
        '</div>'
      );
    }).join('');

    recentArea.innerHTML =
      '<div class="recent-section">' +
        '<div class="section-title">最近记录</div>' +
        itemsHtml +
      '</div>';
  },

  openScannerPage() {
    if (!this._isDataReady) {
      this.showToast('基础数据未加载完成，暂时无法抽检', true);
      return;
    }

    this.showPage('page-scanner');
    this._hideInspectionActions();
    this.renderResultCard(this._buildIdleResult());
    this.renderRecentInspections();
    if (typeof Scanner !== 'undefined' && Scanner && typeof Scanner.start === 'function') {
      Scanner.start('scanner-container', (normalizedCode, rawText) => {
        this._handleScannedBarcode(normalizedCode, rawText);
      }).catch(() => {
        this.showToast('扫码器启动失败', true);
      });
    }
  },

  async _handleScannedBarcode(normalizedCode, rawText) {
    const inspection = this._buildInspectionResult(normalizedCode, rawText);

    const isDuplicate = this._recentInspections.some(
      (item) => item.normalizedCode === normalizedCode
    );

    const partsHtml = this._buildPartsHtml(inspection.inStockParts);

    this.renderResultCard({
      badge: inspection.result === 'warning' ? '异常警示' : '抽检正常',
      title: inspection.normalizedCode,
      message:
        '原始值：' + Utils.esc(inspection.rawCode) + '<br>' +
        '结果：' + Utils.esc(inspection.message) + '<br>' +
        (isDuplicate ? '<span style="color:var(--warning)">此条码已抽检过，不再重复记录</span><br>' : '') +
        '数据源：' + Utils.esc(inspection.matchedSource) +
        partsHtml,
      className: inspection.result === 'warning' ? 'result-warning' : 'result-normal'
    });

    if (!isDuplicate) {
      try {
        await DB.createInspection(inspection);
        this._recentInspections = [inspection].concat(this._recentInspections).slice(0, 10);
        this.renderRecentInspections();
      } catch (error) {
        this.showToast('抽检记录保存失败', true);
      }
    }

    if (inspection.result === 'warning') {
      Utils.vibrate([220, 120, 220]);
      this.showToast(isDuplicate ? '命中已出库清单（已记录）' : '命中已出库清单，请立即核查', true);
    } else if (inspection.inStockParts) {
      Utils.vibrate(100);
      this.showToast(isDuplicate ? '命中在库清单（已记录）' : '命中在库清单，请核对零件');
    } else {
      Utils.vibrate(100);
      this.showToast(isDuplicate ? '未命中（已记录）' : '未命中任何清单');
    }

    this._showInspectionActions();
  },

  _buildInspectionResult(normalizedCode, rawText) {
    const plainCode = Utils.toPlainBarcode(normalizedCode);
    const isShippedOut = this._shippedOutCodeSet.has(normalizedCode) || this._shippedOutPlainSet.has(plainCode);
    const inStockItems = this._inStockCodeSet.has(normalizedCode)
      ? this._inStockMap[normalizedCode]
      : this._inStockPlainSet.has(plainCode)
        ? this._inStockMap['JY' + plainCode] || null
        : null;

    if (isShippedOut) {
      return {
        id: Utils.generateId(),
        rawCode: rawText,
        normalizedCode,
        plainCode,
        result: 'warning',
        message: '命中已出库清单，疑似异常出库',
        matchedSource: this._indexData ? this._indexData.source : '-',
        inStockParts: null,
        scannedAt: Utils.nowISO()
      };
    }

    if (inStockItems && Array.isArray(inStockItems) && inStockItems.length > 0) {
      return {
        id: Utils.generateId(),
        rawCode: rawText,
        normalizedCode,
        plainCode,
        result: 'normal',
        message: '命中在库清单，请核对以下零件信息',
        matchedSource: this._indexData ? this._indexData.source : '-',
        inStockParts: inStockItems.slice(),
        scannedAt: Utils.nowISO()
      };
    }

    return {
      id: Utils.generateId(),
      rawCode: rawText,
      normalizedCode,
      plainCode,
      result: 'normal',
      message: '未命中任何清单，可继续抽检',
      matchedSource: this._indexData ? this._indexData.source : '-',
      inStockParts: null,
      scannedAt: Utils.nowISO()
    };
  },

  _buildPartsHtml(parts) {
    if (!parts || !Array.isArray(parts) || parts.length === 0) return '';
    const rows = parts.map((item) => {
      const part = item.part || '-';
      const qty = item.qty != null ? item.qty : null;
      const moqPerTray = this._partTrayMap[part] || null;

      let trayInfo = '-';
      if (qty != null && moqPerTray && moqPerTray > 0) {
        const fullTrays = Math.floor(qty / moqPerTray);
        const remainder = qty % moqPerTray;
        const totalTrays = (qty / moqPerTray).toFixed(1);
        if (remainder === 0) {
          trayInfo = totalTrays + ' 托';
        } else if (fullTrays > 0) {
          trayInfo = fullTrays + ' 托 + ' + remainder + ' 件';
        } else {
          trayInfo = '0 托 + ' + remainder + ' 件';
        }
        trayInfo += '<br><span class="parts-ref">每托 ' + moqPerTray + ' 件</span>';
      } else if (qty != null) {
        trayInfo = String(qty);
      }

      return (
        '<tr>' +
          '<td>' + Utils.esc(part) + '</td>' +
          '<td>' + Utils.esc(String(qty != null ? qty : '-')) + '</td>' +
          '<td>' + trayInfo + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="parts-detail">' +
        '<div class="parts-detail-title">在库零件明细</div>' +
        '<table class="parts-table">' +
          '<thead><tr><th>零件号</th><th>剩余数量</th><th>托数</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  },

  _restartScannerWithDelay() {
    this._hideInspectionActions();
    setTimeout(() => {
      if (this.currentPage !== 'page-scanner') return;
      this.renderResultCard(this._buildIdleResult());
      if (typeof Scanner !== 'undefined' && Scanner && typeof Scanner.start === 'function') {
        Scanner.start('scanner-container', (normalizedCode, rawText) => {
          this._handleScannedBarcode(normalizedCode, rawText);
        }).catch(() => {
          this.showToast('扫码器启动失败', true);
        });
      }
    }, 900);
  },

  _showInspectionActions() {
    var el = document.getElementById('inspection-actions');
    if (el) el.style.display = '';
  },

  _hideInspectionActions() {
    var el = document.getElementById('inspection-actions');
    if (el) el.style.display = 'none';
  },

  continueInspection() {
    this._restartScannerWithDelay();
  },

  endInspection() {
    if (typeof Scanner !== 'undefined' && Scanner && typeof Scanner.stop === 'function') {
      Scanner.stop();
    }
    this._hideInspectionActions();
    this.showPage('page-home');
  },

  backToHome() {
    if (typeof Scanner !== 'undefined' && Scanner && typeof Scanner.stop === 'function') {
      Scanner.stop();
    }
    this.showPage('page-home');
  },

  _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    if (sessionStorage.getItem('sw-updated') === 'true') {
      sessionStorage.removeItem('sw-updated');
      setTimeout(() => this.showToast('应用已更新至 v' + this.VERSION), 500);
    }

    navigator.serviceWorker.register('sw.js').then((reg) => {
      // 每次加载都检查更新
      reg.update();

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          // 新 SW 已安装但正在等待激活
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this.showToast('发现新版本，即将刷新...', true);
            // 立即激活新 SW（配合 sw.js 的 skipWaiting）
            if (newWorker.postMessage) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          }

          // 新 SW 已激活，立即刷新页面
          if (newWorker.state === 'activated') {
            sessionStorage.setItem('sw-updated', 'true');
            window.location.reload();
          }
        });
      });

      // 兜底：监听 controller 变化
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!sessionStorage.getItem('sw-updated')) {
          sessionStorage.setItem('sw-updated', 'true');
          window.location.reload();
        }
      });

    }).catch(() => {
      this.showToast('Service Worker 注册失败', true);
    });
  },

  _doRefresh() {
    this.showToast('正在刷新...');
    const url = window.location.origin + window.location.pathname + '?_t=' + Date.now();
    setTimeout(() => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          return reg ? reg.unregister() : Promise.resolve();
        }).then(() => {
          if ('caches' in window) {
            return caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))));
          }
          return Promise.resolve();
        }).then(() => {
          window.location.href = url;
        }).catch(() => {
          window.location.href = url;
        });
        return;
      }
      window.location.href = url;
    }, 300);
  },

  _bindEvents() {
    document.getElementById('btn-start-inspection').addEventListener('click', () => {
      this.openScannerPage();
    });

    document.getElementById('btn-back-home').addEventListener('click', () => {
      this.backToHome();
    });

    document.getElementById('btn-continue-scan').addEventListener('click', () => {
      this.continueInspection();
    });

    document.getElementById('btn-cancel-scan').addEventListener('click', () => {
      this.endInspection();
    });

    window.addEventListener('beforeunload', () => {
      if (typeof Scanner !== 'undefined' && Scanner && typeof Scanner.stop === 'function') {
        Scanner.stop();
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
