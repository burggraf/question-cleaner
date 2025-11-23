# Question Cleanup Script

This script reviews and rewrites Jeopardy questions that may have issues with:
1. Awkward "clue" references inserted by AI
2. Time-dependent "air date" references that may be outdated
3. Other date/timing issues that make questions incorrect

## Usage

```bash
# Run on default database (./jeopardy.db) with 5 parallel workers (default)
bun run cleanup-questions.ts

# Run on specific database
bun run cleanup-questions.ts /path/to/database.db

# Adjust concurrency (number of parallel workers)
bun run cleanup-questions.ts --concurrency 10

# Combine options
bun run cleanup-questions.ts /path/to/database.db --concurrency 10
```

### Performance Tips

- **Default concurrency**: 5 parallel workers
- **Increase concurrency**: Use `--concurrency 10` or higher for faster processing (if your API quota allows)
- **Decrease concurrency**: Use `--concurrency 1` for slower, more conservative processing
- Processing 2,565 questions:
  - At 1 worker: ~2-3 hours
  - At 5 workers: ~30-45 minutes
  - At 10 workers: ~15-25 minutes

## What it does

1. **Builds Queue**: Searches for questions containing "clue" or "air date" (case insensitive) in the question or original_question fields

2. **Reviews Each Question**: Sends each question to Gemini AI with context about the potential issues

3. **Smart Updates**:
   - If question is valid (e.g., references board game "Clue"), it's skipped
   - If question needs fixing, Gemini rewrites it with:
     - Removed awkward "clue" references
     - Updated time-dependent information
     - Clear standalone trivia format (no Jeopardy context needed)
     - Same difficulty level maintained

4. **Tracks Changes**:
   - Adds metadata field `{"QUESTION_REWRITE": "<timestamp>"}` to updated questions
   - Logs all changes to `cleanup-questions.log` for audit trail

5. **Progress Display**: Shows real-time progress with counts of updated/skipped questions

## Current Queue Size

The script found **2,565 questions** that match the criteria and need review.

## Requirements

- Bun runtime
- `gemini` CLI tool installed and in PATH
- Gemini API key configured
- SQLite database with questions table

## Safety Features

- Non-destructive: Original question preserved in `original_question` field
- Metadata tracking: All rewrites timestamped
- Audit logging: All changes logged to `cleanup-questions.log` with before/after comparison
- Smart detection: Skips legitimately valid questions
- Error handling: Continues processing if individual questions fail
- Rate limiting: 1 second delay between API calls

## Audit Log Format

The `cleanup-questions.log` file contains detailed before/after records for every changed question:

```
================================================================================
ID: abc123
Timestamp: 2025-11-23T12:34:56.789Z
================================================================================

BEFORE:
Q: In this clue, the answer references a famous detective...
A: Sherlock Holmes
B: Hercule Poirot
C: Miss Marple
D: Sam Spade

AFTER:
Q: Which famous detective lives at 221B Baker Street?
A: Sherlock Holmes
B: Hercule Poirot
C: Miss Marple
D: Sam Spade
```

## Example Output

```
╔════════════════════════════════════════════════════════════╗
║       Jeopardy Question Cleanup Script                    ║
╚════════════════════════════════════════════════════════════╝

Database: ./jeopardy.db

🔍 Building queue of questions to review...

📋 Found 10562 questions to review

🚀 Starting question cleanup process...

================================================================================
Processing 1/10562: abc123
================================================================================
Question: In this clue, the answer references...

✏️  Updated question
   New: What game features Colonel Mustard and the candlestick?

📊 Progress: 10/10562 (0.1%)
   ✅ Updated: 7
   ⏭️  Skipped (valid): 3
```

## Notes

- Processing 10,562 questions will take several hours due to rate limiting
- Consider running in a screen/tmux session for long runs
- The script can be safely interrupted and rerun (already-processed questions with metadata can be filtered out if needed)
