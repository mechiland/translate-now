export interface TranslationCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export class MemoryCache implements TranslationCache {
  private map = new Map<string, string>();
  constructor(private max = 5000) {}
  async get(key: string) {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  async set(key: string, value: string) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  async clear() {
    this.map.clear();
  }
  async count() {
    return this.map.size;
  }
}

const DB_NAME = 'translate-now';
const STORE = 'translations';

interface Row {
  k: string;
  v: string;
  t: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** IndexedDB-backed cache with approximate LRU eviction by last-access time. */
export class IdbCache implements TranslationCache {
  private dbPromise: Promise<IDBDatabase> | undefined;
  private writes = 0;

  constructor(private maxEntries = 50_000) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore(STORE, { keyPath: 'k' });
        store.createIndex('t', 't');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(STORE, mode).objectStore(STORE);
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const row = (await req((await this.store('readonly')).get(key))) as Row | undefined;
      if (!row) return undefined;
      // Touch occasionally so frequently used entries survive eviction.
      if (Date.now() - row.t > 24 * 3600_000) {
        void this.store('readwrite').then((s) => s.put({ ...row, t: Date.now() }));
      }
      return row.v;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await req(
        (await this.store('readwrite')).put({ k: key, v: value, t: Date.now() } satisfies Row),
      );
      if (++this.writes % 200 === 0) await this.evict();
    } catch {
      // Cache failures must never break translation.
    }
  }

  async clear(): Promise<void> {
    await req((await this.store('readwrite')).clear());
  }

  async count(): Promise<number> {
    return req((await this.store('readonly')).count());
  }

  private async evict(): Promise<void> {
    const total = await this.count();
    if (total <= this.maxEntries) return;
    let toDelete = total - Math.floor(this.maxEntries * 0.9);
    const store = await this.store('readwrite');
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.index('t').openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || toDelete <= 0) return resolve();
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }
}
