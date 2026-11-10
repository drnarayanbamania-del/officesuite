import { create } from 'zustand';
import {
  deleteFile as dbDeleteFile,
  putFile,
  listFiles,
  type FileKind,
  type StoredFile,
} from '../lib/db';
import { mimeOf, uid } from '../lib/files';

interface FilesState {
  files: StoredFile[];
  loading: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
  save: (input: {
    id?: string;
    name: string;
    kind: FileKind;
    bytes: ArrayBuffer;
    mime?: string;
    meta?: Record<string, unknown>;
  }) => Promise<StoredFile>;
  remove: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
}

export const useFiles = create<FilesState>((set, get) => ({
  files: [],
  loading: false,
  loaded: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const files = await listFiles();
      set({ files, loading: false, loaded: true });
    } catch (error) {
      console.error(error);
      set({ loading: false, loaded: true });
    }
  },
  save: async ({ id, name, kind, bytes, mime, meta }) => {
    const existing = id ? get().files.find((f) => f.id === id) : undefined;
    const now = Date.now();
    const file: StoredFile = {
      id: id ?? uid('doc'),
      name,
      kind,
      mime: mime ?? mimeOf(name),
      size: bytes.byteLength,
      bytes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      favorite: existing?.favorite ?? false,
      meta,
    };
    await putFile(file);
    set((s) => ({ files: [file, ...s.files.filter((f) => f.id !== file.id)] }));
    return file;
  },
  remove: async (id) => {
    await dbDeleteFile(id);
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },
  toggleFavorite: async (id) => {
    const file = get().files.find((f) => f.id === id);
    if (!file) return;
    const next = { ...file, favorite: !file.favorite };
    await putFile(next);
    set((s) => ({ files: s.files.map((f) => (f.id === id ? next : f)) }));
  },
  rename: async (id, name) => {
    const file = get().files.find((f) => f.id === id);
    if (!file) return;
    const next = { ...file, name, updatedAt: Date.now() };
    await putFile(next);
    set((s) => ({ files: s.files.map((f) => (f.id === id ? next : f)) }));
  },
}));
