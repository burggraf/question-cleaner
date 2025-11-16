# Trivia Question Validator

Validates trivia questions in SQLite database using the `gemini` CLI command.

## Prerequisites

- **Bun** runtime installed
- **`gemini` CLI** command available (uses your Gemini Pro subscription)

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Verify Gemini CLI Works

Test that the `gemini` command works:

```bash
gemini -p "Hello"
```

If this works, you're all set! The tool will use this same command.

## Usage

### Single Worker

```bash
bun run validate-questions.ts
```

### Parallel Processing (Recommended)

For faster processing, run multiple workers in parallel:

```bash
# Run 3 workers in parallel (recommended for 4-core machines)
bun run validate-questions.ts --worker-id=1 &
bun run validate-questions.ts --worker-id=2 &
bun run validate-questions.ts --worker-id=3 &
```

Each worker will:
1. Test the `gemini` CLI is working
2. Connect to the SQLite database
3. Atomically claim batches of 25 questions (no collision)
4. Process each batch using `gemini -p "<prompt>"`
5. Update the `metadata` field with validation results
6. Show progress after each batch

### Recovery from Interruptions

If workers are interrupted (Ctrl+C, crash, etc.), questions may be stuck in `PROCESSING` state. Use the `--reclaim` flag to reset them:

```bash
bun run validate-questions.ts --reclaim
```

This will mark all `PROCESSING` questions as unprocessed so they can be claimed again.

## Database Schema

Expects SQLite database `questions.db` with table:

```sql
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  question TEXT,
  answer_a TEXT,
  answer_b TEXT,
  answer_c TEXT,
  answer_d TEXT,
  category TEXT,
  subcategory TEXT,
  difficulty TEXT,
  metadata TEXT
);
```

## Validation Tags

- `OK` - Question is valid
- `INCORRECT` - Answer is wrong
- `AMBIGUOUS` - Question is too ambiguous
- `INCOMPLETE` - Question is incomplete
- `UNCLEAR` - Question is unclear
- `OBVIOUS` - Answer is in the question
- `OVERDETAILED-ANSWER` - Correct answer has too much detail

Multiple tags can appear space-separated.

## Output

```
Trivia Question Validator (Using Gemini CLI)

Testing Gemini CLI...
Gemini CLI is working!

Opening database...
Found 61251 questions to validate

Processed 1/61251 questions
Processed 2/61251 questions
Processed 3/61251 questions
...
```

## Performance

- **Speed:** ~1.7 seconds per question with batch processing (25 questions per CLI call)
- **Parallel Processing:** 3-4 workers can reduce total time from 29 hours to ~7-10 hours
- **Cost:** Uses your Gemini Pro subscription (no additional API costs)
- **Safe to interrupt:** Press Ctrl+C anytime and resume later (use `--reclaim` to reset stuck questions)
- **Progress saved:** Each batch is saved immediately after validation
- **No collisions:** Workers atomically claim batches using database transactions

## Troubleshooting

### "Failed to run Gemini CLI: command not found"
The `gemini` command is not in your PATH. Make sure it's installed and accessible.

### "Database file not found"
Ensure `questions.db` exists in the current directory where you're running the command.

### Gemini CLI returns errors
Check that your Gemini Pro subscription is active and you're logged in to the CLI.
