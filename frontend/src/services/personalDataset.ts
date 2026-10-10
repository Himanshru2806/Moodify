import type { ExpressionLabel } from '../types';

const DATABASE_NAME = 'moodify-personal-expression-dataset';
const DATABASE_VERSION = 1;
const STORE_NAME = 'contributions';

export interface PersonalDatasetContribution {
  id: string;
  image: Blob;
  expression: ExpressionLabel;
  createdAt: string;
}

export interface NewPersonalDatasetContribution {
  id: string;
  image: Blob;
  expression: ExpressionLabel;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('This browser does not support local personal dataset storage.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open personal dataset storage.'));
    request.onblocked = () => reject(new Error('Personal dataset storage is blocked by another open tab.'));
  });
}

function runTransaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error ?? new Error('Could not access the personal dataset.'));
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Personal dataset change was cancelled.'));
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Personal dataset storage failed.'));
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
  }));
}

export async function listPersonalDatasetContributions(): Promise<PersonalDatasetContribution[]> {
  const records = await runTransaction<PersonalDatasetContribution[]>('readonly', (store) => store.getAll());
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function savePersonalDatasetContribution(
  contribution: NewPersonalDatasetContribution,
): Promise<IDBValidKey> {
  return runTransaction<IDBValidKey>('readwrite', (store) => store.add({
    ...contribution,
    createdAt: new Date().toISOString(),
  }));
}

export async function deletePersonalDatasetContribution(id: string): Promise<void> {
  await runTransaction<undefined>('readwrite', (store) => store.delete(id));
}

export async function clearPersonalDataset(): Promise<void> {
  await runTransaction<undefined>('readwrite', (store) => store.clear());
}

export function createContributionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
