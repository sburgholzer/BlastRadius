import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(5);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('returns undefined for missing keys and tracks misses', () => {
    const cache = new LRUCache<string, number>(5);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
  });

  it('evicts least recently used entry when at capacity', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.size).toBe(3);
  });

  it('accessing an entry promotes it so it is not evicted', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // promote 'a'
    cache.set('d', 4); // should evict 'b' (now least recently used)
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('updating an existing key does not increase size', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // update existing
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
  });

  it('tracks hits and misses correctly', () => {
    const cache = new LRUCache<string, number>(5);
    cache.set('x', 42);
    cache.get('x'); // hit
    cache.get('x'); // hit
    cache.get('y'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it('delete removes an entry', () => {
    const cache = new LRUCache<string, number>(5);
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('delete returns false for non-existent key', () => {
    const cache = new LRUCache<string, number>(5);
    expect(cache.delete('nope')).toBe(false);
  });

  it('clear resets entries and counters', () => {
    const cache = new LRUCache<string, number>(5);
    cache.set('a', 1);
    cache.get('a');
    cache.get('missing');
    cache.clear();
    expect(cache.size).toBe(0);
    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.size).toBe(0);
  });

  it('defaults to 10,000 max size', () => {
    const cache = new LRUCache<string, number>();
    expect(cache.getStats().maxSize).toBe(10_000);
  });

  it('throws if maxSize is less than 1', () => {
    expect(() => new LRUCache(0)).toThrow('maxSize must be at least 1');
    expect(() => new LRUCache(-1)).toThrow('maxSize must be at least 1');
  });

  it('getStats reports current size and maxSize', () => {
    const cache = new LRUCache<string, number>(100);
    cache.set('a', 1);
    cache.set('b', 2);
    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(100);
  });
});

// --- Property-Based Tests ---

/**
 * Property-based tests for LRU Cache dependency lookup caching.
 *
 * Feature: blast-radius-visualizer
 * Property 7: Dependency Cache Prevents Redundant Lookups
 *
 * Validates: Requirements 3.5
 *
 * For any sequence of resource relationship lookups during an analysis run,
 * a lookup for a resource that has already been resolved SHALL return the
 * cached result without making an additional API call, up to the 10,000-entry
 * cache limit.
 */

// --- Custom Arbitraries / Generators ---

/**
 * Generates a cache operation: either a 'set' (simulating a resolved lookup)
 * or a 'get' (simulating a subsequent lookup).
 */
type CacheOp =
  | { type: 'set'; key: string; value: number }
  | { type: 'get'; key: string };

function arbitraryCacheKey(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_:/.'.split('')),
    { minLength: 1, maxLength: 30 }
  );
}

function arbitraryCacheOp(): fc.Arbitrary<CacheOp> {
  return fc.oneof(
    fc.record({
      type: fc.constant('set' as const),
      key: arbitraryCacheKey(),
      value: fc.integer({ min: 0, max: 100_000 }),
    }),
    fc.record({
      type: fc.constant('get' as const),
      key: arbitraryCacheKey(),
    })
  );
}

describe('Feature: blast-radius-visualizer, Property 7: Dependency Cache Prevents Redundant Lookups', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * After setting a key-value pair, getting that key returns the same value (cache hit).
   * This verifies that once a resource relationship is resolved and cached,
   * subsequent lookups return the cached result.
   */
  it('after setting a key-value pair, getting that key returns the same value (cache hit)', () => {
    fc.assert(
      fc.property(
        arbitraryCacheKey(),
        fc.integer({ min: 0, max: 100_000 }),
        (key, value) => {
          const cache = new LRUCache<string, number>(10_000);
          cache.set(key, value);
          const result = cache.get(key);
          expect(result).toBe(value);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Getting a key that was never set returns undefined (cache miss).
   * This verifies that the cache correctly distinguishes between resolved
   * and unresolved resources.
   */
  it('getting a key that was never set returns undefined (cache miss)', () => {
    fc.assert(
      fc.property(
        arbitraryCacheKey(),
        fc.array(
          fc.record({
            key: arbitraryCacheKey(),
            value: fc.integer({ min: 0, max: 100_000 }),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        (lookupKey, entries) => {
          const cache = new LRUCache<string, number>(10_000);
          // Insert entries that do NOT include the lookup key
          for (const entry of entries) {
            if (entry.key !== lookupKey) {
              cache.set(entry.key, entry.value);
            }
          }
          const result = cache.get(lookupKey);
          expect(result).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * After filling the cache to capacity, the least recently used entry is evicted.
   * This verifies the 10,000-entry cache limit behavior — when the cache is full,
   * new entries evict the LRU entry.
   */
  it('after filling the cache to capacity, the least recently used entry is evicted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 3, maxLength: 60 }),
        (capacity, values) => {
          fc.pre(values.length > capacity);

          const cache = new LRUCache<number, number>(capacity);

          // Fill the cache beyond capacity
          for (let i = 0; i < values.length; i++) {
            cache.set(i, values[i]);
          }

          // The first (values.length - capacity) keys should have been evicted
          const evictedCount = values.length - capacity;
          for (let i = 0; i < evictedCount; i++) {
            expect(cache.has(i)).toBe(false);
          }

          // The last `capacity` keys should still be present
          for (let i = evictedCount; i < values.length; i++) {
            expect(cache.get(i)).toBe(values[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Cache stats correctly track hits and misses for any sequence of operations.
   * This verifies that the cache accurately reports lookup statistics for
   * inclusion in analysis output (cacheStats: { hits, misses }).
   */
  it('cache stats correctly track hits and misses', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryCacheOp(), { minLength: 1, maxLength: 100 }),
        (ops) => {
          const cache = new LRUCache<string, number>(10_000);
          let expectedHits = 0;
          let expectedMisses = 0;
          const currentEntries = new Map<string, number>();

          for (const op of ops) {
            if (op.type === 'set') {
              cache.set(op.key, op.value);
              currentEntries.set(op.key, op.value);
            } else {
              // 'get' operation
              if (currentEntries.has(op.key)) {
                expectedHits++;
              } else {
                expectedMisses++;
              }
              cache.get(op.key);
            }
          }

          const stats = cache.getStats();
          expect(stats.hits).toBe(expectedHits);
          expect(stats.misses).toBe(expectedMisses);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * For any sequence of set/get operations, the cache never exceeds its max size.
   * This verifies the 10,000-entry cache limit is always respected regardless
   * of the operation sequence.
   */
  it('for any sequence of set/get operations, the cache never exceeds its max size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.array(arbitraryCacheOp(), { minLength: 1, maxLength: 200 }),
        (maxSize, ops) => {
          const cache = new LRUCache<string, number>(maxSize);

          for (const op of ops) {
            if (op.type === 'set') {
              cache.set(op.key, op.value);
            } else {
              cache.get(op.key);
            }
            // After every operation, size must not exceed maxSize
            expect(cache.size).toBeLessThanOrEqual(maxSize);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
