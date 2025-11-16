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

```bash
bun run validate-questions.ts
```

The tool will:
1. Test the `gemini` CLI is working
2. Connect to the SQLite database
3. Process questions one at a time using `gemini -p "<prompt>"`
4. Update the `metadata` field with validation results
5. Show progress after each question

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

- **Speed:** Depends on `gemini` CLI response time
- **Cost:** Uses your Gemini Pro subscription (no additional API costs)
- **Safe to interrupt:** Press Ctrl+C anytime and resume later
- **Progress saved:** Each question is saved immediately after validation

## Troubleshooting

### "Failed to run Gemini CLI: command not found"
The `gemini` command is not in your PATH. Make sure it's installed and accessible.

### "Database file not found"
Ensure `questions.db` exists in the current directory where you're running the command.

### Gemini CLI returns errors
Check that your Gemini Pro subscription is active and you're logged in to the CLI.
