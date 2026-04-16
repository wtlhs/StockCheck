'use strict';

const Utils = {
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  formatDate(isoString) {
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  nowISO() {
    return new Date().toISOString();
  },

  esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  },

  normalizeBarcode(text) {
    if (typeof text !== 'string') return null;
    const normalized = text.replace(/\s+/g, '').toUpperCase();
    if (!normalized) return null;
    if (/^\d{7}$/.test(normalized)) return 'JY' + normalized;
    if (/^JY\d{7}$/.test(normalized)) return normalized;
    return null;
  },

  isTargetBarcode(text) {
    return this.normalizeBarcode(text) !== null;
  },

  toPlainBarcode(text) {
    const normalized = this.normalizeBarcode(text);
    if (!normalized) return null;
    return normalized.slice(2);
  },

  parsePositiveInt(value) {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  },

  vibrate(ms = 100) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }
};
