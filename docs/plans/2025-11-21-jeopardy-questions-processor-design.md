# Jeopardy Questions Processor Design

**Date:** 2025-11-21
**Purpose:** Transform 529,939 Jeopardy questions into multiple-choice format using Gemini 2.0 Flash API

## Overview

A Bun-based CLI application that processes Jeopardy questions from a SQLite database, using the Gemini 2.0 Flash model to convert them into multiple-choice questions with four options (a, b, c, d) where 'a' is always the correct answer.

## Requirements

### Functional Requirements
1. Process questions in batches of 100
2. Update question wording to proper question form (if needed)
3. Verify answer 'a' is still correct (update if outdated with explanation in metadata)
4. Generate three plausible but incorrect distractors (b, c, d)
5. Flag ambiguous, unclear, or outdated questions in metadata
6. Resume processing from last incomplete batch
7. Display real-time progress (batch number, percentage, ETA)

### Technical Requirements
- Use Bun runtime
- SQLite database: `jeopardy.db`
- Gemini 2.0 Flash API via API key authentication (GEMINI_API_KEY env var)
- Sequential single-threaded processing
- Support `--limit N` flag to process only N batches
- Support `--db PATH` and `--batch-size N` flags

## Architecture

### Components

**1. Database Layer**
- Built-in `bun:sqlite` (no external dependencies)
- Query unprocessed questions: `WHERE b IS NULL OR b = ''`
- Atomic transactions per batch
- Indexes for performance

**2. Gemini Client**
- Direct API integration using fetch
- Structured JSON prompts with question context
- Temperature: 0.7 for creative but controlled output
- Parse JSON array responses

**3. Validator**
- Check all 4 options are unique
- Verify no empty options
- Validate JSON metadata format
- Skip invalid batches (log and continue)

**4. Progress Tracker**
- Console output with current batch/total
- Percentage complete
- Failed batches count
- ETA calculation
- Log files: `processing.log` and `failed-batches.log`

### CLI Interface

```bash
bun run process.ts                    # Process all questions
bun run process.ts --limit 10         # Process 10 batches (1000 questions)
bun run process.ts --db ./test.db     # Use different database
bun run process.ts --batch-size 50    # Process 50 questions per batch
```

## Data Flow

### 1. Query Phase
```sql
SELECT * FROM questions
WHERE (b IS NULL OR b = '' OR b = ' ')
LIMIT 100
```

Index creation on startup:
```sql
CREATE INDEX IF NOT EXISTS idx_questions_b ON questions(b);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(b, c, d);
```

### 2. Prompt Construction
- Single API call per batch (100 questions)
- System prompt with task instructions
- Each question includes: category, current answer, air_date
- Request JSON array response: `[{id, question, a, b, c, d, metadata}]`

### 3. Gemini Response Parsing
- Expect JSON array with 100 objects
- Required fields: id, question, a, b, c, d
- Optional field: metadata (only when issues found)

### 4. Validation
- **Uniqueness**: `new Set([a,b,c,d]).size === 4`
- **Non-empty**: All options have `.trim().length > 0`
- **Metadata**: If present, must parse as valid JSON

### 5. Database Update
```sql
BEGIN TRANSACTION;
UPDATE questions
SET question=?, a=?, b=?, c=?, d=?, metadata=?
WHERE id=?;
-- Repeat for all 100 questions
COMMIT;
```

One transaction per batch - rollback entire batch on any failure.

### 6. Progress Logging
```
Batch 53/5300 (1%) | 5,300/529,939 questions | 47 failed | ETA: 3h 42m
```

## Error Handling

### Fatal Errors (STOP PROCESSING)
- Network errors
- Rate limits (429)
- Server errors (5xx)

**Behavior:** Display full error message, exit immediately with error code.

### Recoverable Errors (SKIP AND CONTINUE)
- Invalid JSON response from Gemini
- Partial responses (< 100 questions)
- Validation failures

**Behavior:** Log error with batch details, skip batch (leaves b/c/d empty), continue to next batch.

### Resume Capability
- No state file needed
- Query naturally finds unprocessed questions (empty b/c/d)
- Restart application to resume after crash or stop

### Rate Limiting
- 1-2 second delay between batches
- Prevents hitting Gemini API rate limits
- Configurable constant in code

## Logging

**Console Output:**
- Real-time progress updates
- Immediate error display
- Completion summary

**processing.log:**
- Timestamp for each batch
- Batch number and question range
- Any errors or warnings

**failed-batches.log:**
- Batch number
- Question IDs in batch
- Failure reason
- Raw response (if applicable)

## Testing Strategy

1. **Single Batch Test:** `--limit 1` → Manually verify 100 questions
2. **Small Scale Test:** `--limit 10` → Verify 1,000 questions
3. **Full Run:** No limit → Process all 529,939 questions

## Database Schema

### Assumed Structure
```sql
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  round INTEGER,
  clue_value INTEGER,
  daily_double_value INTEGER,
  category TEXT,
  comments TEXT,
  question TEXT,
  a TEXT,           -- Correct answer
  b TEXT,           -- Distractor 1
  c TEXT,           -- Distractor 2
  d TEXT,           -- Distractor 3
  air_date TEXT,
  notes TEXT,
  original_question TEXT,
  metadata TEXT     -- JSON object for issues/updates
);
```

## Performance Estimates

- **Total batches:** ~5,300 (529,939 / 100)
- **Time per batch:** 3-5 seconds (API call + processing + delay)
- **Total runtime:** 4-5 hours for complete dataset

## Gemini Prompt Strategy

**Context Provided:**
- Question category (helps with plausible distractors)
- Air date (helps identify outdated information)
- Current answer in field 'a'

**Instructions:**
- Maintain answer 'a' as correct
- Generate creative but clearly incorrect distractors
- Flag any ambiguity or issues in metadata JSON
- Update answer if factually outdated (with explanation)

**Temperature:** 0.7 (balanced creativity and control)

## Edge Cases

- **Partial data:** Questions with some fields filled → Reprocessed if any of b/c/d are empty
- **Unicode/special characters:** Handled via JSON encoding
- **Very long answers:** Accept Gemini's output (may truncate)
- **Date-sensitive questions:** Gemini uses air_date to assess if update needed
- **Metadata format:** `{"issue": "reason"}` or `{"ambiguous": "reason"}` or any relevant key
