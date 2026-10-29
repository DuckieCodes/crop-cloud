// Keeps the original files behind Crop Cloud's recent list in IndexedDB,
// so any app in the suite can reopen them later.
const FileStore = (() => {
  const DB_NAME = 'cropcloud-files';
  const STORE = 'files';
  let dbPromise = null;

  function open() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    put: (id, blob) => run('readwrite', (s) => s.put(blob, id)),
    get: (id) => run('readonly', (s) => s.get(id)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
    keys: () => run('readonly', (s) => s.getAllKeys()),
    clear: () => run('readwrite', (s) => s.clear()),
  };
})();
