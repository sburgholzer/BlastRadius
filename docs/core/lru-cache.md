← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# LRU Cache (lru-cache.ts)

A performance optimization for the Resource Resolver.

**The problem:** When traversing the dependency graph, the same resource might be referenced by multiple paths. Without a cache, we'd call AWS Config repeatedly for the same resource — wasting time and hitting rate limits.

**LRU = Least Recently Used.** A cache that remembers the last 10,000 lookups. When it's full and a new entry comes in, it throws away whichever entry hasn't been accessed in the longest time. Think of it like a desk with limited space — you keep the papers you're actively using on top, and when the desk is full, you file away the one you haven't touched in the longest time.

**How it works:** Uses a JavaScript `Map` (which preserves insertion order). When you `get` a key, it moves to the "most recently used" end. When the map is full and you `set` a new key, it deletes the first entry (the "least recently used").

```typescript
const cache = new LRUCache<string, Relationship[]>(10_000);

// First lookup: calls AWS Config, stores result
cache.set('sg-abc123', relationships);

// Second lookup for same resource: instant, no API call
const cached = cache.get('sg-abc123'); // returns relationships
```

**Stats tracking:** The cache counts hits (found in cache) and misses (had to call AWS). These are included in the output so you can see effectiveness — e.g. "Cache: 847 hits, 203 misses" means we avoided 847 redundant API calls.

**Why 10,000?** Balance between Lambda memory limits and coverage. Most analyses involve fewer than 10,000 unique resources, so the cache rarely evicts anything during a single run.
