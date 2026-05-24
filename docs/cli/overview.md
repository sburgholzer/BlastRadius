← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# CLI (packages/cli)

A single file (`src/index.ts`) that wraps the REST API for use in CI/CD pipelines. It's what Jenkins, GitHub Actions, or GitLab CI would call to gate deployments.

**The mental model:** It's like the frontend but for robots. Instead of a visual graph, it outputs JSON. Instead of clicking buttons, it uses exit codes (0 = proceed, 1 = stop, 2 = broken).

**Three commands:**
```bash
# "Should I deploy this?" — the main use case
blast-radius analyze --format terraform-plan --input plan.json --threshold 75 --ci

# "Is my analysis done yet?"
blast-radius status --analysis-id abc-123

# "Give me the full results"
blast-radius export --analysis-id abc-123 --format json
```

**The `analyze` command flow:**
1. Read input (from `--input` file path or stdin pipe)
2. Parse as JSON (fail with exit 2 if invalid)
3. Validate threshold if provided (fail with exit 2 if outside 0-100)
4. POST to the API → get back full analysis results
5. If `--threshold` was set → evaluate pass/fail verdict
6. Output results (JSON in `--ci` mode, human-readable otherwise)
7. Exit with appropriate code

**Two output modes:**

Human-readable (default):
```
✓ PASS - No resources exceed the risk threshold.
  Total affected resources: 12
  Highest impact score: 68
```

Machine-readable (`--ci` flag):
```json
{ "verdict": "pass", "exitCode": 0, "summary": { "totalAffected": 12, "highestScore": 68 } }
```

**Input flexibility:**
```bash
terraform show -json plan.out | blast-radius analyze --format terraform-plan --threshold 75 --ci
cat changeset.json | blast-radius analyze --format cloudformation --ci
blast-radius analyze --input my-manifest.json --format canonical
```

**The `ApiClient` interface — why it matters for testing:**
```typescript
interface ApiClient {
  submitAnalysis(payload, options): Promise<AnalysisResult>;
  getStatus(analysisId): Promise<AnalysisStatus>;
  getExport(analysisId, format): Promise<AnalysisResult>;
}
```
In production, makes HTTP calls to the real API. In tests, inject a mock that returns fake data. The CLI's 37 tests run instantly with zero network calls — testing argument parsing, verdict logic, and output formatting in isolation.

**Environment:** Needs `BLAST_RADIUS_API_URL` set to the API Gateway endpoint URL.
