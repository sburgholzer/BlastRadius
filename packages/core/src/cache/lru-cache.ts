/**
 * Statistics about cache usage for reporting in analysis output.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

/**
 * Generic LRU (Least Recently Used) cache implementation.
 *
 * Uses a Map for O(1) lookups. Map preserves insertion order in JavaScript,
 * so the first entry is the least recently used and the last entry is the
 * most recently used.
 *
 * Default capacity: 10,000 entries (per Resource Resolver design spec).
 */
export class LRUCache<K, V> {
  private readonly cache: Map<K, V>;
  private readonly _maxSize: number;
  private _hits: number;
  private _misses: number;

  constructor(maxSize: number = 10_000) {
    if (maxSize < 1) {
      throw new Error('maxSize must be at least 1');
    }
    this.cache = new Map();
    this._maxSize = maxSize;
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Retrieve a value by key. Moves the entry to the most recently used position.
   * Tracks hits and misses for reporting.
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used) by deleting and re-inserting
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    this._hits++;
    return value;
  }

  /**
   * Insert or update a key-value pair. If at capacity, evicts the least
   * recently used entry (first entry in the Map).
   */
  set(key: K, value: V): void {
    // If key already exists, delete it first so it moves to the end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this._maxSize) {
      // Evict the least recently used entry (first key in the Map)
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache. Does not affect LRU ordering.
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Remove a specific entry from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries and reset hit/miss counters.
   */
  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Get cache usage statistics for inclusion in analysis output.
   */
  getStats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.cache.size,
      maxSize: this._maxSize,
    };
  }

  /**
   * Current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }
}
