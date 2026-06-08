import "client-only";

const VOICE_DRAFT_DB_NAME = "cloude-code-voice-drafts";
const VOICE_DRAFT_DB_VERSION = 1;
const VOICE_DRAFT_STORE_NAME = "drafts";
const LATEST_VOICE_DRAFT_KEY = "latest";

export type VoiceDraft = {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function openVoiceDraftDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable");
  }

  const request = indexedDB.open(VOICE_DRAFT_DB_NAME, VOICE_DRAFT_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(VOICE_DRAFT_STORE_NAME)) {
      db.createObjectStore(VOICE_DRAFT_STORE_NAME);
    }
  };

  return requestToPromise(request);
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function saveLatestVoiceDraft(draft: VoiceDraft): Promise<void> {
  const db = await openVoiceDraftDb();
  try {
    const transaction = db.transaction(VOICE_DRAFT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(VOICE_DRAFT_STORE_NAME);
    store.clear();
    store.put(draft, LATEST_VOICE_DRAFT_KEY);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}

export async function loadLatestVoiceDraft(): Promise<VoiceDraft | null> {
  const db = await openVoiceDraftDb();
  try {
    const transaction = db.transaction(VOICE_DRAFT_STORE_NAME, "readonly");
    const store = transaction.objectStore(VOICE_DRAFT_STORE_NAME);
    const draft = await requestToPromise<VoiceDraft | undefined>(
      store.get(LATEST_VOICE_DRAFT_KEY),
    );
    return draft ?? null;
  } finally {
    db.close();
  }
}

export async function deleteLatestVoiceDraft(): Promise<void> {
  const db = await openVoiceDraftDb();
  try {
    const transaction = db.transaction(VOICE_DRAFT_STORE_NAME, "readwrite");
    transaction.objectStore(VOICE_DRAFT_STORE_NAME).delete(LATEST_VOICE_DRAFT_KEY);
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}
