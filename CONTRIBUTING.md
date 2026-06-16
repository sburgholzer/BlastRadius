# Contributing to Blast Radius

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/sburgholzer/BlastRadius.git
cd BlastRadius
npm install
npm run build
npm test
```

Requires Node.js 20+.

## Workflow

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run lint: `npm run lint && npm run format:check`
6. Commit with a descriptive message
7. Push and open a PR against `main`

## PR Requirements

PRs are automatically checked by CI:
- All packages must build
- All 349+ tests must pass
- ESLint + Prettier must pass
- CDK synth must succeed (if infra/lambdas/core changed)

## Code Style

- TypeScript strict mode
- Single quotes, semicolons, trailing commas
- Prettier handles formatting — run `npm run format` before committing
- See `.kiro/steering/project.md` for full conventions

## Project Structure

| Package | What it does |
|---------|-------------|
| `packages/core` | Shared models, validation, scoring logic |
| `packages/lambdas` | Lambda handlers for the pipeline |
| `packages/cli` | CLI tool for local use and CI/CD |
| `packages/frontend` | React SPA with dependency graph |
| `packages/infra` | CDK infrastructure stack |

## Key Patterns

**Dependency injection** — Lambda handlers accept optional `deps` parameter:
```typescript
export async function handler(event: Input, deps?: Deps): Promise<Output> {
  const { client } = deps && 'client' in deps ? deps : createDefaultDeps();
}
```
Tests pass mocks directly. No module mocking needed.

**Async handlers** — All Lambda handlers must be `async`. Node.js 22 runtime returns `null` for synchronous handlers.

**Property-based tests** — We use `fast-check` for correctness properties. Add property tests for new logic that has invariants.

## Adding a New Adapter

To support a new IaC format (e.g., Pulumi):

1. Create `packages/lambdas/src/adapters/pulumi/handler.ts`
2. Implement the conversion to canonical `ResourceChangeManifest`
3. Make the handler `async`
4. Add tests in `packages/lambdas/src/adapters/adapters.spec.ts`
5. Add the Lambda to `packages/infra/src/stacks/blast-radius-stack.ts`
6. Add a seed entry in the adapter registry section of the stack
7. Update docs

## Questions?

Open an issue or start a discussion. We're happy to help.
