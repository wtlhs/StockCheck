'use strict';

const DB = {
  DB_NAME: 'InventoryDB',
  DB_VERSION: 4,

  _db: null,

  async open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const legacyStores = ['sessions', 'records', 'outbounds'];

        legacyStores.forEach((storeName) => {
          if (db.objectStoreNames.contains(storeName)) {
            db.deleteObjectStore(storeName);
          }
        });

        let inspectionStore;
        if (db.objectStoreNames.contains('inspections')) {
          inspectionStore = request.transaction.objectStore('inspections');
        } else {
          inspectionStore = db.createObjectStore('inspections', { keyPath: 'id' });
        }

        if (!inspectionStore.indexNames.contains('scannedAt')) {
          inspectionStore.createIndex('scannedAt', 'scannedAt');
        }
        if (!inspectionStore.indexNames.contains('normalizedCode')) {
          inspectionStore.createIndex('normalizedCode', 'normalizedCode');
        }
        if (!inspectionStore.indexNames.contains('result')) {
          inspectionStore.createIndex('result', 'result');
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        this._db.onversionchange = () => {
          this._db.close();
          this._db = null;
        };
        resolve(this._db);
      };

      request.onerror = (event) => reject(event.target.error);
      request.onblocked = () => reject(new Error('数据库升级被阻塞，请关闭其他标签页后重试'));
    });
  },

  async createInspection(inspection) {
    await this.open();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('inspections', 'readwrite');
      const store = tx.objectStore('inspections');
      store.add({ ...inspection });
      tx.oncomplete = () => resolve(inspection);
      tx.onerror = (event) => reject(event.target.error);
    });
  },

  async getRecentInspections(limit = 10) {
    await this.open();

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('inspections', 'readonly');
      const store = tx.objectStore('inspections');
      const request = store.getAll();

      request.onsuccess = () => {
        const items = request.result
          .slice()
          .sort((a, b) => String(b.scannedAt).localeCompare(String(a.scannedAt)));
        resolve(items.slice(0, limit));
      };

      request.onerror = (event) => reject(event.target.error);
      tx.onerror = (event) => reject(event.target.error);
    });
  }
};
