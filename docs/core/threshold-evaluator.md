← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Threshold Evaluator (threshold-evaluator.ts)

The decision maker for CI/CD pipelines. It answers one question: "should this deployment be allowed to proceed?"

**How it works:** You set a threshold (say 75). If *any* resource in the analysis has an `impactScore` above 75, the verdict is "fail" and the pipeline stops. If nothing exceeds it, the verdict is "pass" and deployment continues.

```
Threshold = 75

Resources: [score 40, score 68, score 92, score 55]
                                    ↑
                              92 > 75 = FAIL
```

**The three possible outcomes:**

| Verdict | Exit Code | When | What the pipeline does |
|---------|-----------|------|----------------------|
| `pass` | 0 | No resource exceeds threshold | Deployment proceeds |
| `fail` | 1 | At least one resource exceeds threshold | Deployment blocked |
| `error` | 2 | Invalid threshold (null, non-integer, outside 0-100) | Pipeline errors out |

**On pass**, you get a summary: total affected resources and the highest score found (so you know how close you were to failing).

**On fail**, you get the list of specific resources that exceeded the threshold — their IDs, types, scores, and dependency chains. This tells the engineer exactly *what* to investigate.

**Why it's in `core` and not `lambdas`:** Both the CLI and the Lambda pipeline use it. The CLI evaluates the verdict locally after getting results from the API. Having it in `core` means it's shared without duplication.

**Threshold validation:** Also validates the threshold itself. If someone passes `--threshold abc` or `--threshold 150`, it returns an error verdict (exit code 2) with a message explaining the valid range is 0-100 integers.
