import type { EvidenceFrame } from '../types/analysis.ts';
import { log } from '../utils/logger.ts';

/**
 * Evidence frames, in IndexedDB.
 *
 * They cannot live in `chrome.storage.local`: three JPEGs per event across a
 * dozen events is roughly a megabyte per analysis, and the quota is ten. They
 * also should not live in React state, where a completed analysis would pin
 * every frame in memory for as long as the panel is open.
 *
 * So: one object store keyed by frame id, indexed by analysis id, with the
 * oldest analyses evicted once the store passes its budget. Losing an old
 * analysis's frames costs a before/after strip; losing the analysis itself
 * would cost the user their work, which is why the two are stored apart.
 */

const DB_NAME = 'motion-inspector';
const DB_VERSION = 1;
const STORE = 'evidence-frames';
const MAX_ANALYSES = 12;

interface StoredFrame extends EvidenceFrame {
  analysisId: string;
  storedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('analysisId', 'analysisId', { unique: false });
        store.createIndex('storedAt', 'storedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      log.warn('frame store unavailable', { error: String(request.error) });
      resolve(null);
    };
  });

  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function putFrames(analysisId: string, frames: EvidenceFrame[]): Promise<void> {
  const db = await openDb();
  if (!db || frames.length === 0) return;

  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const storedAt = Date.now();
  for (const frame of frames) {
    store.put({ ...frame, analysisId, storedAt } satisfies StoredFrame);
  }
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      log.warn('frame write failed', { error: String(tx.error) });
      resolve();
    };
  });

  await evict(db);
}

export async function readFrames(analysisId: string): Promise<EvidenceFrame[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const index = db.transaction(STORE, 'readonly').objectStore(STORE).index('analysisId');
    const rows = await promisify<StoredFrame[]>(index.getAll(analysisId) as IDBRequest<StoredFrame[]>);
    return rows
      .sort((a, b) => a.time - b.time)
      .map(({ id, candidateId, role, time, dataUrl }) => ({ id, candidateId, role, time, dataUrl }));
  } catch (error) {
    log.warn('frame read failed', { error: String(error) });
    return [];
  }
}

export async function deleteFrames(analysisId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const index = tx.objectStore(STORE).index('analysisId');
    const keys = await promisify<IDBValidKey[]>(index.getAllKeys(analysisId));
    for (const key of keys) tx.objectStore(STORE).delete(key);
  } catch (error) {
    log.warn('frame delete failed', { error: String(error) });
  }
}

export async function clearFrames(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
  } catch (error) {
    log.warn('frame clear failed', { error: String(error) });
  }
}

/** Keeps the newest MAX_ANALYSES analyses and drops the rest, oldest first. */
async function evict(db: IDBDatabase): Promise<void> {
  try {
    const rows = await promisify<StoredFrame[]>(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<StoredFrame[]>,
    );
    const newestByAnalysis = new Map<string, number>();
    for (const row of rows) {
      newestByAnalysis.set(row.analysisId, Math.max(newestByAnalysis.get(row.analysisId) ?? 0, row.storedAt));
    }
    if (newestByAnalysis.size <= MAX_ANALYSES) return;

    const doomed = [...newestByAnalysis.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(MAX_ANALYSES)
      .map(([analysisId]) => analysisId);

    const tx = db.transaction(STORE, 'readwrite');
    for (const row of rows) {
      if (doomed.includes(row.analysisId)) tx.objectStore(STORE).delete(row.id);
    }
    log.debug('evicted frame sets', { count: doomed.length });
  } catch (error) {
    log.warn('frame eviction failed', { error: String(error) });
  }
}
