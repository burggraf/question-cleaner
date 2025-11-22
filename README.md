# Jeopardy Questions Processor

Transforms Jeopardy questions into multiple-choice format using Gemini 2.5 Flash API with parallel processing.

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Set your Gemini API key(s):

   **Option A: Using .keys file (recommended for multiple keys):**

   Create a `.keys` file in the project root with one API key per line:
   ```
   AIzaSyAYO2P5AI1jiSYSxW9rq0V4OoBIOz_dOzs
   AIzaSyBXYZ123456789abcdefghijklmnopqr
   AIzaSyC987654321zyxwvutsrqponmlkjihg
   ```

   Lines starting with `#` are treated as comments and ignored.
   The `.keys` file is already in `.gitignore` for security.

   **Option B: Environment variable (single key):**
   ```bash
   export GEMINI_API_KEY='your-api-key'
   ```

   **Option C: Environment variable (multiple keys, comma-separated):**
   ```bash
   export GEMINI_API_KEY='key1,key2,key3'
   ```

   **Note:** If `.keys` file exists, it will be used instead of the environment variable.

3. Make sure `jeopardy.db` is in the project root

## Usage

**Default (5 parallel workers):**
```bash
bun start
```

**Test with 2 workers and 5 batches:**
```bash
bun start --workers 2 --limit 5
```

**High throughput (requires paid API tier):**
```bash
bun start --workers 10 --delay 6000
```

**All options:**
```bash
bun start \
  --workers 5 \           # Parallel workers (default: 5)
  --batch-size 100 \      # Questions per batch (default: 100)
  --delay 3000 \          # Milliseconds between batches (default: 3000)
  --limit 10 \            # Max batches to process (optional)
  --db ./jeopardy.db      # Database path (default: ./jeopardy.db)
```

## Testing

Run all tests:
```bash
bun test
```

## Logs

- `processing.log` - All processing activity with timestamps
- `failed-batches.log` - Details of failed batches for manual review

## How It Works

1. **Migration**: Adds `processing_status` column on first run to track batch states
2. **Crash Recovery**: Resets any stuck `processing` batches to `unprocessed` on startup
3. **Parallel Workers**: Launches N async workers (default: 5) that run concurrently
4. **Atomic Claiming**: Each worker atomically claims batches via database transactions
5. **Processing**: Sends batches to Gemini 2.5 Flash API for question generation
6. **Validation**: Checks uniqueness, non-empty options, and sanitizes invalid JSON metadata
7. **Database Update**: Marks questions as `completed` with generated options
8. **Graceful Shutdown**: Ctrl+C waits for workers to finish current batches

## Error Handling

**Automatic recovery with key rotation:**
- **429 Quota Exceeded**: Marks current key as exhausted (permanently removed from rotation), automatically switches to next available key with 5-second delay. Continues until all keys are exhausted.

**Automatic retry with backoff:**
- **503 Service Unavailable**: Pauses for 30 seconds and retries up to 10 times before stopping

**Fatal errors (stops all workers):**
- All API keys exhausted (all keys hit quota limits)
- 10 consecutive 503 errors
- Other rate limits (429)
- Server errors (5xx)
- Network errors (ECONNREFUSED, ENOTFOUND)

**Non-fatal errors (logs and continues):**
- Invalid JSON responses
- Validation failures
- Partial batch responses

Failed batches are marked as `unprocessed` and will be retried on next run.

## Performance

**Sequential (1 worker):**
- ~5,300 batches for full dataset (529,939 questions)
- ~5 seconds per batch (API call + processing)
- **Total time: ~7.5 hours**

**Parallel (5 workers, default):**
- 5 workers × 3s delay = ~10 requests/minute
- Stays safely under 15 RPM free tier limit
- **Total time: ~53 minutes** (3.3x speedup)

**Parallel (10 workers, paid tier):**
- 10 workers × 6s delay = ~10 requests/minute (safe pacing)
- **Total time: ~26 minutes** (17x speedup vs sequential)

Rate limit formula: `requests_per_minute = (workers × 60) / delay_ms`
