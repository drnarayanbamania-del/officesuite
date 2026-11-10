import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type FileKind = 'writer' | 'sheet' | 'slides' | 'pdf' | 'other';

export interface StoredFile {
  id: string;
  name: string;
  kind: FileKind;
  mime: string;
  size: number;
  bytes: ArrayBuffer;
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  meta?: Record<string, unknown>;
}

export interface FileVersion {
  id: string;
  fileId: string;
  name: string;
  bytes: ArrayBuffer;
  size: number;
  createdAt: number;
  note?: string;
}

interface NovaDB extends DBSchema {
  files: {
    key: string;
    value: StoredFile;
    indexes: { 'by-updated': number; 'by-kind': string };
  };
  versions: {
    key: string;
    value: FileVersion;
    indexes: { 'by-file': string };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
}

const DB_NAME = 'novaoffice';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<NovaDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<NovaDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('files')) {
          const files = database.createObjectStore('files', { keyPath: 'id' });
          files.createIndex('by-updated', 'updatedAt');
          files.createIndex('by-kind', 'kind');
        }
        if (!database.objectStoreNames.contains('versions')) {
          const versions = database.createObjectStore('versions', { keyPath: 'id' });
          versions.createIndex('by-file', 'fileId');
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' });
        }
      },
      blocked() {
        console.warn('Office Suite database upgrade blocked by another tab.');
      },
    });
  }
  return dbPromise;
}

export async function listFiles(): Promise<StoredFile[]> {
  const database = await db();
  const all = await database.getAll('files');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  return (await db()).get('files', id);
}

export async function putFile(file: StoredFile): Promise<void> {
  await (await db()).put('files', file);
}

export async function deleteFile(id: string): Promise<void> {
  const database = await db();
  await database.delete('files', id);
  const versions = await database.getAllFromIndex('versions', 'by-file', id);
  await Promise.all(versions.map((v) => database.delete('versions', v.id)));
}

export async function addVersion(
  file: StoredFile,
  note = 'Autosaved before change'
): Promise<void> {
  const database = await db();
  await database.put('versions', {
    id: `${file.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileId: file.id,
    name: file.name,
    bytes: file.bytes,
    size: file.size,
    createdAt: Date.now(),
    note,
  });
  const existing = await database.getAllFromIndex('versions', 'by-file', file.id);
  const ordered = existing.sort((a, b) => b.createdAt - a.createdAt);
  for (const stale of ordered.slice(20)) {
    await database.delete('versions', stale.id);
  }
}

export async function listVersions(fileId: string): Promise<FileVersion[]> {
  const database = await db();
  const versions = await database.getAllFromIndex('versions', 'by-file', fileId);
  return versions.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteVersion(id: string): Promise<void> {
  await (await db()).delete('versions', id);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await (await db()).get('settings', key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', { key, value });
}

export async function clearAllData(): Promise<void> {
  const database = await db();
  await database.clear('files');
  await database.clear('versions');
  await database.clear('settings');
}
