// Save-game storage with four backends:
//  - Desktop (Electron): JSON files in the user's app-data folder via the preload bridge.
//  - Web: IndexedDB on this device (big quota, its own space even when other games share the
//    same site, as every HTML game on itch.io does), mirrored to localStorage as a backup.
//  - Cloud (claude.ai artifact runtime): a private per-player document, so saves follow the player.
// The web build writes everywhere it can and reads whichever copy is newest. A save only counts as
// failed if no copy could be written, and then the game tells the player.

export interface SaveMeta {
  slot: string;
  savedAt: number;
  company: string;
  day: number;
  cash: number;
  level: number;
  stores: number;
}
export interface SaveFile {
  meta: SaveMeta;
  data: string;
}

interface Backend {
  name: string;
  list(): Promise<SaveMeta[]>;
  load(slot: string): Promise<SaveFile | null>;
  save(file: SaveFile): Promise<void>;
  remove(slot: string): Promise<void>;
}

// ------------------------------------------------------------ desktop
interface NativeBridge {
  listSaves(): Promise<SaveMeta[]>;
  loadSave(slot: string): Promise<SaveFile | null>;
  writeSave(file: SaveFile): Promise<void>;
  deleteSave(slot: string): Promise<void>;
  quit(): void;
  toggleFullscreen(): void;
  isDesktop: true;
}
export function native(): NativeBridge | null {
  return (window as unknown as { pizzaNative?: NativeBridge }).pizzaNative ?? null;
}

const desktopBackend = (n: NativeBridge): Backend => ({
  name: 'desktop',
  list: () => n.listSaves(),
  load: (slot) => n.loadSave(slot),
  save: (f) => n.writeSave(f),
  remove: (slot) => n.deleteSave(slot),
});

// ------------------------------------------------------------ local
const PREFIX = 'pizzasim.save.';
const localBackend: Backend = {
  name: 'local',
  async list() {
    const out: SaveMeta[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const f = JSON.parse(raw) as SaveFile;
        if (f?.meta) out.push(f.meta);
      }
    } catch {
      /* storage unavailable */
    }
    return out;
  },
  async load(slot) {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      return raw ? (JSON.parse(raw) as SaveFile) : null;
    } catch {
      return null;
    }
  },
  async save(f) {
    // throws on quota or blocked storage, so the facade knows this copy didn't stick
    localStorage.setItem(PREFIX + f.meta.slot, JSON.stringify(f));
  },
  async remove(slot) {
    try {
      localStorage.removeItem(PREFIX + slot);
    } catch {
      /* ignore */
    }
  },
};

// ------------------------------------------------------------ IndexedDB
const IDB_NAME = 'pizzasim', IDB_STORE = 'saves';
function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // a slow device can take a while to open the database: wait for it rather than give up
    } catch {
      resolve(null);
    }
  });
}
function idbBackend(db: IDBDatabase): Backend {
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, mode);
        const r = fn(tx.objectStore(IDB_STORE));
        tx.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('aborted'));
      } catch (e) {
        reject(e);
      }
    });
  return {
    name: 'idb',
    async list() {
      try {
        const all = ((await run<SaveFile[]>('readonly', (s) => s.getAll())) ?? []) as SaveFile[];
        return all.filter((f) => f?.meta).map((f) => f.meta);
      } catch {
        return [];
      }
    },
    async load(slot) {
      try {
        return ((await run<SaveFile>('readonly', (s) => s.get(slot))) as SaveFile | undefined) ?? null;
      } catch {
        return null;
      }
    },
    async save(f) {
      await run('readwrite', (s) => s.put(f, f.meta.slot)); // throws if it didn't stick
    },
    async remove(slot) {
      try {
        await run('readwrite', (s) => s.delete(slot));
      } catch {
        /* ignore */
      }
    },
  };
}

// ------------------------------------------------------------ cloud (artifact runtime)
type DocSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
type DocRef = { get(): Promise<DocSnap>; set(d: Record<string, unknown>): Promise<unknown>; delete(): Promise<unknown> };
type Db = { collection(p: string): { doc(id: string): DocRef } };
type UserCap = { id(): Promise<string | null> };
type ClaudeRuntime = { use(name: string): Promise<unknown> };

async function cloudBackend(): Promise<Backend | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return null;
  try {
    const [db, user] = (await Promise.all([claude.use('db'), claude.use('user')])) as [Db | null, UserCap | null];
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    const col = db.collection('data/users/' + uid);
    const ref = (slot: string) => col.doc('save_' + slot);
    const slots = ['auto', '1', '2', '3'];
    let writeChain: Promise<unknown> = Promise.resolve();
    return {
      name: 'cloud',
      async list() {
        const out: SaveMeta[] = [];
        await Promise.all(
          slots.map(async (s) => {
            try {
              const snap = await ref(s).get();
              const d = snap.exists ? snap.data() : undefined;
              if (d?.meta) out.push(d.meta as SaveMeta);
            } catch {
              /* ignore */
            }
          }),
        );
        return out;
      },
      async load(slot) {
        try {
          const snap = await ref(slot).get();
          const d = snap.exists ? snap.data() : undefined;
          return d ? ({ meta: d.meta as SaveMeta, data: String(d.data) } as SaveFile) : null;
        } catch {
          return null;
        }
      },
      async save(f) {
        // one write at a time per document
        writeChain = writeChain.then(() => ref(f.meta.slot).set({ meta: f.meta, data: f.data })).catch(() => undefined);
        await writeChain;
      },
      async remove(slot) {
        try {
          await ref(slot).delete();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ facade
export interface SaveResult {
  ok: boolean;
}
const newest = (xs: (SaveFile | null)[]) => xs.reduce<SaveFile | null>((a, b) => (b && (!a || b.meta.savedAt > a.meta.savedAt) ? b : a), null);

class SaveStore {
  /** Where saves go, in order. On the web: IndexedDB, then localStorage as a mirror. */
  private backends: Backend[] = [];
  private cloud: Backend | null = null;
  ready: Promise<void>;
  constructor() {
    const n = native();
    if (n) {
      this.backends = [desktopBackend(n)];
      this.ready = Promise.resolve();
      return;
    }
    this.backends = [localBackend];
    const idb = openIdb().then((db) => {
      if (db) this.backends = [idbBackend(db), localBackend];
    });
    // don't hold the title screen hostage: after a few seconds go on with localStorage, and pick
    // IndexedDB up whenever it finishes opening
    const idbOrLater = Promise.race([idb, new Promise<void>((r) => setTimeout(r, 6000))]);
    this.ready = Promise.all([
      idbOrLater,
      cloudBackend().then((c) => {
        this.cloud = c;
      }),
    ]).then(() => {
      // ask the browser not to clear our saves when space runs low (granted quietly or not at all)
      try {
        navigator.storage?.persist?.().catch(() => undefined);
      } catch {
        /* ignore */
      }
    });
  }
  get where() {
    if (this.backends[0]?.name === 'desktop') return 'Saved to your PC';
    return this.cloud ? 'Saved to your account and this device' : 'Saved in this browser';
  }
  private all() {
    return this.cloud ? [...this.backends, this.cloud] : this.backends;
  }
  async list(): Promise<SaveMeta[]> {
    await this.ready;
    const map = new Map<string, SaveMeta>();
    for (const b of this.all()) {
      for (const m of await b.list().catch(() => [] as SaveMeta[])) {
        if (m.slot.startsWith('__')) continue;
        const cur = map.get(m.slot);
        if (!cur || m.savedAt > cur.savedAt) map.set(m.slot, m);
      }
    }
    return [...map.values()].sort((a, b) => b.savedAt - a.savedAt);
  }
  async load(slot: string): Promise<SaveFile | null> {
    await this.ready;
    return newest(await Promise.all(this.all().map((b) => b.load(slot).catch(() => null))));
  }
  /** Writes every copy it can. ok is false only when no copy on this device could be written. */
  async save(f: SaveFile): Promise<SaveResult> {
    await this.ready;
    let ok = false;
    for (const b of this.backends) {
      try {
        await b.save(f);
        ok = true;
      } catch {
        /* try the next one */
      }
    }
    if (this.cloud) this.cloud.save(f).then(() => undefined, () => undefined);
    return { ok };
  }
  async remove(slot: string) {
    await this.ready;
    for (const b of this.all()) await b.remove(slot).catch(() => undefined);
  }
  private health: Promise<boolean> | null = null;
  /** Can this browser keep a save at all? Writes and reads back a tiny test value (checked once). */
  healthy(): Promise<boolean> {
    this.health ??= (async () => {
      await this.ready;
      const slot = '__probe' + Math.random().toString(36).slice(2, 8);
      const probe: SaveFile = { meta: { slot, savedAt: Date.now(), company: '', day: 0, cash: 0, level: 0, stores: 0 }, data: 'ok' };
      for (const b of this.backends) {
        try {
          await b.save(probe);
          const back = await b.load(slot);
          await b.remove(slot);
          if (back?.data === 'ok') return true;
        } catch {
          /* next */
        }
      }
      return false;
    })();
    return this.health;
  }
}

export const saves = new SaveStore();
// handy for checking saves from the browser console
(window as unknown as { pizzaSaves?: SaveStore }).pizzaSaves = saves;

// ------------------------------------------------------------ settings (per device)
export interface Settings {
  sound: boolean;
  music: boolean;
  volume: number;
  shadows: boolean;
  floatingText: boolean;
  autoNextDay: boolean;
  quality: 'high' | 'low';
  /** Go full screen on the first tap (windowed when off). */
  fullscreen: boolean;
  /** Classic camera: one-finger drag rotates instead of panning. */
  dragRotate: boolean;
  /** On-screen zoom/turn buttons expanded. */
  camButtons: boolean;
}
const DEFAULT_SETTINGS: Settings = { sound: true, music: true, volume: 0.6, shadows: true, floatingText: true, autoNextDay: false, quality: 'high', fullscreen: true, dragRotate: false, camButtons: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('pizzasim.settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  const mobile = Math.min(window.innerWidth, window.innerHeight) < 600;
  return { ...DEFAULT_SETTINGS, quality: mobile ? 'low' : 'high', shadows: !mobile || true };
}
export function storeSettings(s: Settings) {
  try {
    localStorage.setItem('pizzasim.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
