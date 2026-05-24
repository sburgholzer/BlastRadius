← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Failure Handler

**`pipeline/failure-handler.ts`** — Invoked by Step Functions when a pipeline stage fails. Its job: save whatever we have so far and record what went wrong.

**What it does:**
1. Classifies the error into a category (VALIDATION_ERROR, PERMISSION_DENIED, SERVICE_THROTTLING, TIMEOUT, etc.)
2. Stores partial results in S3 — whatever stages completed before the failure still have value
3. Updates DynamoDB status to "failed" with the error details

**Why partial results matter:** If Ingestion and Discovery succeeded but Scoring failed, you still have the dependency graph. That's useful — you can see *what* depends on your changes even if scoring didn't complete.

**Error classification:** If the error category isn't provided, it guesses from the message text (e.g. "rate limit exceeded" → SERVICE_THROTTLING). This helps the UI show appropriate messages ("try again later" vs "fix your input").

**Non-retryable vs retryable:** The handler exports `isNonRetryable()` which returns true for VALIDATION_ERROR, PERMISSION_DENIED, RESOURCE_NOT_FOUND. Step Functions uses this to decide whether to retry or fail immediately.
