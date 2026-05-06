import type { SupportsStorage } from "./types";

/** In-memory fallback. Replace with AsyncStorage in production. */
export function createMemoryStorage(): SupportsStorage {
  const map = new Map<string, string>();
  return {
    async getItem(k) { return map.get(k) ?? null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
  };
}

/**
 * Wrap @react-native-async-storage/async-storage if you have it installed.
 * Usage: storage: asyncStorageAdapter(require('@react-native-async-storage/async-storage').default)
 */
export function asyncStorageAdapter(asyncStorage: {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
}): SupportsStorage {
  return {
    getItem: (k) => asyncStorage.getItem(k),
    setItem: (k, v) => asyncStorage.setItem(k, v),
    removeItem: (k) => asyncStorage.removeItem(k),
  };
}
