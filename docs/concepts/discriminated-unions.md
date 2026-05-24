← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Discriminated Unions for Results

A TypeScript pattern where a function can return one of several different shapes, and you can tell which one you got by checking a specific field.

**The problem:** A handler can either succeed or fail. Without this pattern:
```typescript
// Bad: unclear what you're getting back
interface Result {
  manifest?: ResourceChangeManifest;  // maybe present?
  error?: string;                     // maybe present?
  statusCode?: number;                // maybe present?
}
```
You're never sure what's there. Did it succeed? Check if `manifest` exists? Easy to get wrong.

**The discriminated union approach:**
```typescript
// Good: it's EITHER a success OR an error, never both
type ValidationResult =
  | { success: true; manifest: ResourceChangeManifest }
  | { success: false; error: string; path?: string };
```

Now TypeScript *forces* you to check which one you got:
```typescript
const result = validateManifest(input);

if (result.success) {
  // TypeScript KNOWS result.manifest exists here
  console.log(result.manifest.resources.length);
} else {
  // TypeScript KNOWS result.error exists here
  console.log(result.error, result.path);
}
```

If you try to access `result.manifest` without checking `result.success` first, TypeScript gives a compile error. You literally can't forget to handle the error case.

**The verdict evaluator — clearest example (three possible outcomes):**
```typescript
type VerdictResult =
  | { verdict: 'pass'; exitCode: 0; summary: { totalAffected: number; highestScore: number } }
  | { verdict: 'fail'; exitCode: 1; exceedingResources: ExceedingResource[]; summary: {...} }
  | { verdict: 'error'; exitCode: 2; message: string };
```

Each outcome has different fields. Check `verdict` to know which shape you have, and TypeScript narrows the type automatically.

**Why it matters:** Makes impossible states impossible. You can't accidentally have a "pass" verdict with an `exceedingResources` list, or a "fail" verdict without one. The type system prevents bugs at compile time rather than catching them at runtime.
