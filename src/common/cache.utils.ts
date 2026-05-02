interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class SimpleCache {
  private store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export const cache = new SimpleCache();
