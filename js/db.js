// Úložisko: IndexedDB (lokálne v prehliadači).
// Celá aplikácia pristupuje k dátam iba cez objekt `repo`. Neskôr stačí vymeniť túto
// implementáciu (alebo ju obaliť) za cloudovú – napr. Supabase / Firebase / Netlify DB –
// a doplniť používateľské účty bez zásahu do UI. Aktivity majú `id`, `addedAt` a `updatedAt`,
// čo je všetko, čo je potrebné na jednoduchú synchronizáciu.
const DB_NAME = 'stopa';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('activities', { keyPath: 'id' });
      db.createObjectStore('tracks', { keyPath: 'id' });
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('activityId', 'activityId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Databáza je blokovaná inou kartou.'));
  });
  return dbPromise;
}

const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transakcia zlyhala'));
  });
}

export const repo = {
  async getAll() {
    return run(['activities'], 'readonly', (t) => wrap(t.objectStore('activities').getAll()));
  },
  async get(id) {
    return run(['activities'], 'readonly', (t) => wrap(t.objectStore('activities').get(id)));
  },
  async getTrack(id) {
    return run(['tracks'], 'readonly', (t) => wrap(t.objectStore('tracks').get(id)));
  },
  async getPhotos(activityId) {
    return run(['photos'], 'readonly', (t) => wrap(t.objectStore('photos').index('activityId').getAll(activityId)));
  },
  async saveNew(activity, track, photos = []) {
    return run(['activities', 'tracks', 'photos'], 'readwrite', (t) => {
      t.objectStore('activities').put(activity);
      t.objectStore('tracks').put({ id: activity.id, ...track });
      const ps = t.objectStore('photos');
      photos.forEach((p) => ps.put(p));
    });
  },
  async putActivity(activity) {
    activity.updatedAt = new Date().toISOString();
    return run(['activities'], 'readwrite', (t) => { t.objectStore('activities').put(activity); });
  },
  async putPhoto(photo) {
    return run(['photos'], 'readwrite', (t) => { t.objectStore('photos').put(photo); });
  },
  async putPhotos(list) {
    return run(['photos'], 'readwrite', (t) => { list.forEach((p) => t.objectStore('photos').put(p)); });
  },
  async deletePhoto(id) {
    return run(['photos'], 'readwrite', (t) => { t.objectStore('photos').delete(id); });
  },
  async remove(id) {
    return run(['activities', 'tracks', 'photos'], 'readwrite', async (t) => {
      t.objectStore('activities').delete(id);
      t.objectStore('tracks').delete(id);
      const keys = await wrap(t.objectStore('photos').index('activityId').getAllKeys(id));
      keys.forEach((k) => t.objectStore('photos').delete(k));
    });
  },
  async clearAll() {
    return run(['activities', 'tracks', 'photos'], 'readwrite', (t) => {
      t.objectStore('activities').clear();
      t.objectStore('tracks').clear();
      t.objectStore('photos').clear();
    });
  },
  async dumpAll() {
    return run(['activities', 'tracks', 'photos'], 'readonly', async (t) => ({
      activities: await wrap(t.objectStore('activities').getAll()),
      tracks: await wrap(t.objectStore('tracks').getAll()),
      photos: await wrap(t.objectStore('photos').getAll()),
    }));
  },
  async restoreAll({ activities, tracks, photos }) {
    return run(['activities', 'tracks', 'photos'], 'readwrite', (t) => {
      activities.forEach((a) => t.objectStore('activities').put(a));
      tracks.forEach((a) => t.objectStore('tracks').put(a));
      photos.forEach((a) => t.objectStore('photos').put(a));
    });
  },
};

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}

// ---------- nastavenia (localStorage) ----------
const SKEY = 'stopa.settings';
const DEFAULTS = { base: 'osm', exaggeration: 1.5, start3d: true };
export const settings = {
  get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...DEFAULTS }; }
  },
  set(patch) {
    try { localStorage.setItem(SKEY, JSON.stringify({ ...this.get(), ...patch })); } catch { /* ignore */ }
  },
};
