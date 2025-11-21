# Parallel Batch Processing Design

**Date:** 2025-11-21
**Status:** Approved
**Author:** Claude + Mark

## Overview

Add parallel processing capability to the Jeopardy questions processor to increase throughput from ~1 batch per 2 seconds to ~5 batches per 3 seconds (2.5x speedup). This reduces total processing time for 529,939 questions from ~295 hours to ~118 hours.

## Goals

1. Enable configurable parallel workers (default: 5)
2. Prevent batch conflicts between workers
3. Support graceful crash recovery
4. Maintain safe API rate limits (stay under 15 RPM free tier)
5. Preserve existing error handling and logging behavior

## Non-Goals

- External process orchestration (pm2, cluster mode)
- Complex distributed coordination (Redis, message queues)
- Real-time progress streaming
- Automatic retry logic for failed batches

## Design Decisions

### 1. Database Schema Changes

Add a `processing_status` column to track batch claims:

```sql
ALTER TABLE questions ADD COLUMN processing_status TEXT DEFAULT 'unprocessed';
CREATE INDEX idx_processing_status ON questions(processing_status);
```

**States:**
- `unprocessed`: Question needs processing
- `processing`: Currently claimed by a worker
- `completed`: Successfully processed

**Migration:**
```sql
UPDATE questions
SET processing_status = 'completed'
WHERE b IS NOT NULL AND b != '' AND b != ' ';
```

**Crash Recovery:**
On startup, reset stuck batches:
```sql
UPDATE questions
SET processing_status = 'unprocessed'
WHERE processing_status = 'processing';
```

### 2. Atomic Batch Claiming

Workers claim batches atomically using transactions:

```typescript
claimBatch(batchSize: number): Question[] {
  return this.db.transaction(() => {
    // 1. Find available question IDs
    const ids = this.db.query(`
      SELECT id FROM questions
      WHERE processing_status = 'unprocessed'
      LIMIT ?
    `).all(batchSize).map(r => r.id);

    if (ids.length === 0) return [];

    // 2. Atomically claim them
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`
      UPDATE questions
      SET processing_status = 'processing'
      WHERE id IN (${placeholders})
    `, ...ids);

    // 3. Return full question data
    return this.db.query(`
      SELECT * FROM questions
      WHERE id IN (${placeholders})
    `).all(...ids);
  })();
}
```

**Why transactions?**
- Prevents race conditions between workers
- Ensures atomicity: all questions claimed or none
- Built-in database support, no external coordination needed

### 3. Worker Architecture

Use async/await with Promise.all for concurrent workers:

```typescript
async run(): Promise<void> {
  this.resetStuckBatches();

  const workerCount = this.config.workers || 5;
  const workers = Array.from({ length: workerCount }, (_, i) =>
    this.worker(i + 1)
  );

  await Promise.all(workers);
}

private async worker(workerId: number): Promise<void> {
  while (!this.stopSignal) {
    const batch = this.db.claimBatch(this.config.batchSize);
    if (batch.length === 0) break;

    try {
      const processed = await this.gemini.processBatch(batch);
      const sanitized = this.validator.sanitizeBatch(processed);

      if (this.validator.validateBatch(sanitized).valid) {
        this.db.updateBatch(sanitized, 'completed');
        this.progress.completeBatch(workerId, batch.length);
      } else {
        this.db.markBatchFailed(batch.map(q => q.id));
        this.progress.failBatch(workerId);
      }
    } catch (error) {
      this.handleError(workerId, batch, error);
    }

    await this.sleep(this.config.delayMs);
  }
}
```

**Why async/await over child processes?**
- Simpler implementation (single process)
- Shared memory for progress tracking
- I/O-bound work (HTTP requests) benefits from concurrency
- Lower overhead than separate processes

### 4. Rate Limiting Strategy

**Default configuration:**
- 5 workers
- 3000ms delay between batches per worker
- ~10 requests/minute total (5 workers × 60s / 3s)
- Safely under 15 RPM free tier limit

**Rate limit calculation:**
```
requests_per_minute = (workers × 60) / delay_seconds
```

Examples:
- 5 workers, 3s delay: 10 req/min ✓ (safe)
- 10 workers, 3s delay: 20 req/min ✗ (may hit limits)
- 10 workers, 6s delay: 10 req/min ✓ (safe)

### 5. Error Handling

**Fatal errors (stop all workers):**
- 429 Rate Limit
- 503 Service Unavailable
- Network errors
- Authentication failures

**Non-fatal errors (log and continue):**
- Validation failures
- Invalid JSON responses
- Partial batch responses

**Graceful shutdown:**
```typescript
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  this.stopSignal = true;
  await this.waitForWorkers();
  process.exit(0);
});
```

Workers finish their current batch before exiting.

### 6. Progress Tracking

Track progress per-worker and aggregate:

```typescript
class ProgressTracker {
  private workerStats: Map<number, { completed: number, failed: number }>;

  getProgress(): string {
    // Aggregate: "Progress: 1000/529939 (0.2%) | ETA: 118h"
    // Per-worker: "Worker 1: 200 completed, 0 failed"
    //             "Worker 2: 180 completed, 1 failed"
  }
}
```

### 7. CLI Interface

```bash
--workers N        # Parallel workers (default: 5)
--batch-size N     # Questions per batch (default: 100)
--delay N          # Milliseconds between batches (default: 3000)
--limit N          # Max batches to process (testing)
--db PATH          # Database path
```

**Examples:**
```bash
# Production run with defaults
bun start

# High throughput (requires paid API tier)
bun start --workers 10 --delay 6000

# Conservative testing
bun start --workers 2 --limit 10

# Aggressive (may hit rate limits)
bun start --workers 10 --delay 3000
```

## Implementation Plan

1. **Database migration**
   - Add processing_status column
   - Create index
   - Migrate existing data

2. **Update DatabaseClient**
   - Add claimBatch() with transaction
   - Add resetStuckBatches()
   - Add markBatchFailed()
   - Update updateBatch() to set status

3. **Update Config**
   - Add workers parameter (default: 5)
   - Increase default delay to 3000ms

4. **Update QuestionProcessor**
   - Add worker() method
   - Update run() to spawn workers
   - Add stopSignal flag
   - Add graceful shutdown handler

5. **Update ProgressTracker**
   - Add per-worker tracking
   - Update display format

6. **Testing**
   - Test with --workers 2 --limit 5
   - Verify no duplicate processing
   - Test crash recovery (kill mid-run)
   - Verify graceful shutdown (Ctrl+C)

## Risks & Mitigations

**Risk:** Database lock contention with many workers
**Mitigation:** SQLite handles this well for reads + occasional writes. If issues arise, reduce workers or increase batch size.

**Risk:** Rate limiting with 5 workers
**Mitigation:** 3s delay keeps us at 10 req/min, well under 15 RPM limit. Monitor logs for 429s.

**Risk:** Worker starvation (some workers finish early)
**Mitigation:** Acceptable - workers naturally load balance by claiming next available batch.

**Risk:** Progress tracking race conditions
**Mitigation:** JavaScript single-threaded execution prevents races in shared ProgressTracker.

## Performance Estimates

**Current (sequential):**
- 1 batch per 2s = 0.5 batches/s
- 5,300 batches = 10,600 seconds = ~3 hours

**With 5 parallel workers:**
- 5 batches per 3s = 1.67 batches/s
- 5,300 batches = 3,180 seconds = ~53 minutes

**Speedup:** 3.3x faster

## Alternatives Considered

**1. Separate batch tracking table**
- More complex schema
- Better observability
- Overkill for current needs
- **Rejected:** Adds complexity without clear benefit

**2. In-memory work queue**
- Fast claiming (no DB queries)
- Requires loading 500k IDs into memory
- Lose in-flight work on crash
- **Rejected:** Memory overhead and crash recovery complexity

**3. Worker threads**
- Isolation between workers
- Message passing overhead
- More complex than async/await
- **Rejected:** No benefit for I/O-bound work

**4. External orchestration (pm2)**
- Production-grade process management
- Requires extra dependencies
- More complex deployment
- **Rejected:** Overkill for single-machine use case
