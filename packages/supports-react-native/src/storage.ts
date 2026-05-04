import type { SupportsStorage } from "./types";

/** In-memory fallback (used when AsyncStorage isn't available, e.g. SSR/tests). */
export function createMemoryStorage(): SupportsStorage {
  const map = new Map<string, string>();
  return {
    async getItem(k) { return map.get(k) ?? null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
  };
}

/**
 * Default storage on React Native: AsyncStorage (bundled as a dep).
 * Falls back to in-memory if the module can't be loaded for any reason.
 */
export function createDefaultStorage(): SupportsStorage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-async-storage/async-storage");
    const AsyncStorage = mod?.default ?? mod;
    if (AsyncStorage?.getItem && AsyncStorage?.setItem && AsyncStorage?.removeItem) {
      return {
        getItem: (k) => AsyncStorage.getItem(k),
        setItem: (k, v) => AsyncStorage.setItem(k, v),
        removeItem: (k) => AsyncStorage.removeItem(k),
      };
    }
  } catch {
    /* fall through to memory */
  }
  return createMemoryStorage();
}

/**
 * Adapter for host apps that prefer to provide AsyncStorage explicitly.
 * This keeps the SDK compatible with apps that manage storage wiring themselves.
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
