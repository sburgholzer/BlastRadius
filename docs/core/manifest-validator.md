← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Manifest Validator (manifest-validator.ts)

This is where the canonical format gets *enforced*. While `manifest.ts` defines the shape, this file actually checks incoming data against it using **Zod** (a TypeScript validation library). Think of it like a bouncer — the interface says "you should look like this," the validator says "you *do* look like this, or you're rejected."

**What it checks:**
- Every resource has a non-empty `resourceType`, `resourceId`, `provider`
- `modificationType` is exactly one of: Add, Modify, Remove, Replace (not "delete" or "UPDATE")
- No more than 200 resources (prevents abuse)
- Payload under 10MB (prevents memory issues)
- Group nesting no deeper than 10 levels (prevents stack overflow from recursion)

**How it reports errors:**
```typescript
type ValidationResult =
  | { success: true; manifest: ResourceChangeManifest }
  | { success: false; error: string; path?: string };
```

On failure, it returns the error message AND the JSON path to the problem. So instead of "invalid manifest" you get `"resourceType must be a non-empty string"` at path `"resources[3].resourceType"` — pointing you to exactly which resource is broken.

**Key design choice: atomic validation.** If resource #47 out of 200 is invalid, the *entire* manifest is rejected. No partial processing. This prevents situations where half your resources get analyzed and half don't.

**Order of checks:**
1. Payload size (reject >10MB before even parsing)
2. Schema validation (Zod checks all fields)
3. Nesting depth (recursive check on groups)

This is the first thing that runs when a manifest enters the system. If it fails here, nothing else executes.
