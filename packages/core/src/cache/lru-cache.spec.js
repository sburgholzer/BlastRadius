"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fc = __importStar(require("fast-check"));
const lru_cache_1 = require("./lru-cache");
(0, vitest_1.describe)('LRUCache', () => {
    (0, vitest_1.it)('stores and retrieves values', () => {
        const cache = new lru_cache_1.LRUCache(5);
        cache.set('a', 1);
        cache.set('b', 2);
        (0, vitest_1.expect)(cache.get('a')).toBe(1);
        (0, vitest_1.expect)(cache.get('b')).toBe(2);
    });
    (0, vitest_1.it)('returns undefined for missing keys and tracks misses', () => {
        const cache = new lru_cache_1.LRUCache(5);
        (0, vitest_1.expect)(cache.get('missing')).toBeUndefined();
        (0, vitest_1.expect)(cache.getStats().misses).toBe(1);
    });
    (0, vitest_1.it)('evicts least recently used entry when at capacity', () => {
        const cache = new lru_cache_1.LRUCache(3);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // should evict 'a'
        (0, vitest_1.expect)(cache.has('a')).toBe(false);
        (0, vitest_1.expect)(cache.has('b')).toBe(true);
        (0, vitest_1.expect)(cache.has('c')).toBe(true);
        (0, vitest_1.expect)(cache.has('d')).toBe(true);
        (0, vitest_1.expect)(cache.size).toBe(3);
    });
    (0, vitest_1.it)('accessing an entry promotes it so it is not evicted', () => {
        const cache = new lru_cache_1.LRUCache(3);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.get('a'); // promote 'a'
        cache.set('d', 4); // should evict 'b' (now least recently used)
        (0, vitest_1.expect)(cache.has('a')).toBe(true);
        (0, vitest_1.expect)(cache.has('b')).toBe(false);
        (0, vitest_1.expect)(cache.has('d')).toBe(true);
    });
    (0, vitest_1.it)('updating an existing key does not increase size', () => {
        const cache = new lru_cache_1.LRUCache(3);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10); // update existing
        (0, vitest_1.expect)(cache.size).toBe(2);
        (0, vitest_1.expect)(cache.get('a')).toBe(10);
    });
    (0, vitest_1.it)('tracks hits and misses correctly', () => {
        const cache = new lru_cache_1.LRUCache(5);
        cache.set('x', 42);
        cache.get('x'); // hit
        cache.get('x'); // hit
        cache.get('y'); // miss
        const stats = cache.getStats();
        (0, vitest_1.expect)(stats.hits).toBe(2);
        (0, vitest_1.expect)(stats.misses).toBe(1);
    });
    (0, vitest_1.it)('delete removes an entry', () => {
        const cache = new lru_cache_1.LRUCache(5);
        cache.set('a', 1);
        (0, vitest_1.expect)(cache.delete('a')).toBe(true);
        (0, vitest_1.expect)(cache.has('a')).toBe(false);
        (0, vitest_1.expect)(cache.size).toBe(0);
    });
    (0, vitest_1.it)('delete returns false for non-existent key', () => {
        const cache = new lru_cache_1.LRUCache(5);
        (0, vitest_1.expect)(cache.delete('nope')).toBe(false);
    });
    (0, vitest_1.it)('clear resets entries and counters', () => {
        const cache = new lru_cache_1.LRUCache(5);
        cache.set('a', 1);
        cache.get('a');
        cache.get('missing');
        cache.clear();
        (0, vitest_1.expect)(cache.size).toBe(0);
        const stats = cache.getStats();
        (0, vitest_1.expect)(stats.hits).toBe(0);
        (0, vitest_1.expect)(stats.misses).toBe(0);
        (0, vitest_1.expect)(stats.size).toBe(0);
    });
    (0, vitest_1.it)('defaults to 10,000 max size', () => {
        const cache = new lru_cache_1.LRUCache();
        (0, vitest_1.expect)(cache.getStats().maxSize).toBe(10_000);
    });
    (0, vitest_1.it)('throws if maxSize is less than 1', () => {
        (0, vitest_1.expect)(() => new lru_cache_1.LRUCache(0)).toThrow('maxSize must be at least 1');
        (0, vitest_1.expect)(() => new lru_cache_1.LRUCache(-1)).toThrow('maxSize must be at least 1');
    });
    (0, vitest_1.it)('getStats reports current size and maxSize', () => {
        const cache = new lru_cache_1.LRUCache(100);
        cache.set('a', 1);
        cache.set('b', 2);
        const stats = cache.getStats();
        (0, vitest_1.expect)(stats.size).toBe(2);
        (0, vitest_1.expect)(stats.maxSize).toBe(100);
    });
});
function arbitraryCacheKey() {
    return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_:/.'.split('')), { minLength: 1, maxLength: 30 });
}
function arbitraryCacheOp() {
    return fc.oneof(fc.record({
        type: fc.constant('set'),
        key: arbitraryCacheKey(),
        value: fc.integer({ min: 0, max: 100_000 }),
    }), fc.record({
        type: fc.constant('get'),
        key: arbitraryCacheKey(),
    }));
}
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 7: Dependency Cache Prevents Redundant Lookups', () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * After setting a key-value pair, getting that key returns the same value (cache hit).
     * This verifies that once a resource relationship is resolved and cached,
     * subsequent lookups return the cached result.
     */
    (0, vitest_1.it)('after setting a key-value pair, getting that key returns the same value (cache hit)', () => {
        fc.assert(fc.property(arbitraryCacheKey(), fc.integer({ min: 0, max: 100_000 }), (key, value) => {
            const cache = new lru_cache_1.LRUCache(10_000);
            cache.set(key, value);
            const result = cache.get(key);
            (0, vitest_1.expect)(result).toBe(value);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 3.5**
     *
     * Getting a key that was never set returns undefined (cache miss).
     * This verifies that the cache correctly distinguishes between resolved
     * and unresolved resources.
     */
    (0, vitest_1.it)('getting a key that was never set returns undefined (cache miss)', () => {
        fc.assert(fc.property(arbitraryCacheKey(), fc.array(fc.record({
            key: arbitraryCacheKey(),
            value: fc.integer({ min: 0, max: 100_000 }),
        }), { minLength: 0, maxLength: 50 }), (lookupKey, entries) => {
            const cache = new lru_cache_1.LRUCache(10_000);
            // Insert entries that do NOT include the lookup key
            for (const entry of entries) {
                if (entry.key !== lookupKey) {
                    cache.set(entry.key, entry.value);
                }
            }
            const result = cache.get(lookupKey);
            (0, vitest_1.expect)(result).toBeUndefined();
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 3.5**
     *
     * After filling the cache to capacity, the least recently used entry is evicted.
     * This verifies the 10,000-entry cache limit behavior — when the cache is full,
     * new entries evict the LRU entry.
     */
    (0, vitest_1.it)('after filling the cache to capacity, the least recently used entry is evicted', () => {
        fc.assert(fc.property(fc.integer({ min: 2, max: 50 }), fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 3, maxLength: 60 }), (capacity, values) => {
            fc.pre(values.length > capacity);
            const cache = new lru_cache_1.LRUCache(capacity);
            // Fill the cache beyond capacity
            for (let i = 0; i < values.length; i++) {
                cache.set(i, values[i]);
            }
            // The first (values.length - capacity) keys should have been evicted
            const evictedCount = values.length - capacity;
            for (let i = 0; i < evictedCount; i++) {
                (0, vitest_1.expect)(cache.has(i)).toBe(false);
            }
            // The last `capacity` keys should still be present
            for (let i = evictedCount; i < values.length; i++) {
                (0, vitest_1.expect)(cache.get(i)).toBe(values[i]);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 3.5**
     *
     * Cache stats correctly track hits and misses for any sequence of operations.
     * This verifies that the cache accurately reports lookup statistics for
     * inclusion in analysis output (cacheStats: { hits, misses }).
     */
    (0, vitest_1.it)('cache stats correctly track hits and misses', () => {
        fc.assert(fc.property(fc.array(arbitraryCacheOp(), { minLength: 1, maxLength: 100 }), (ops) => {
            const cache = new lru_cache_1.LRUCache(10_000);
            let expectedHits = 0;
            let expectedMisses = 0;
            const currentEntries = new Map();
            for (const op of ops) {
                if (op.type === 'set') {
                    cache.set(op.key, op.value);
                    currentEntries.set(op.key, op.value);
                }
                else {
                    // 'get' operation
                    if (currentEntries.has(op.key)) {
                        expectedHits++;
                    }
                    else {
                        expectedMisses++;
                    }
                    cache.get(op.key);
                }
            }
            const stats = cache.getStats();
            (0, vitest_1.expect)(stats.hits).toBe(expectedHits);
            (0, vitest_1.expect)(stats.misses).toBe(expectedMisses);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 3.5**
     *
     * For any sequence of set/get operations, the cache never exceeds its max size.
     * This verifies the 10,000-entry cache limit is always respected regardless
     * of the operation sequence.
     */
    (0, vitest_1.it)('for any sequence of set/get operations, the cache never exceeds its max size', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), fc.array(arbitraryCacheOp(), { minLength: 1, maxLength: 200 }), (maxSize, ops) => {
            const cache = new lru_cache_1.LRUCache(maxSize);
            for (const op of ops) {
                if (op.type === 'set') {
                    cache.set(op.key, op.value);
                }
                else {
                    cache.get(op.key);
                }
                // After every operation, size must not exceed maxSize
                (0, vitest_1.expect)(cache.size).toBeLessThanOrEqual(maxSize);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=lru-cache.spec.js.map