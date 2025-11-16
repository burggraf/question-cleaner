# Trivia Question Validator

Validates trivia questions in SQLite database using Google's Gemini 2.0 Flash model.

## Prerequisites

- **Bun** runtime installed
- **Google Gemini API key** (free tier available)

## Setup

### 1. Get Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Get API Key" or "Create API Key"
3. Copy your API key

### 2. Set Environment Variable

```bash
export GEMINI_API_KEY="your-api-key-here"
```

For permanent setup, add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
echo 'export GEMINI_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

### 3. Install Dependencies

```bash
bun install
```

## Usage

```bash
bun run validate-questions.ts
```

The tool will:
1. Connect to the SQLite database
2. Process questions in batches of 10
3. Update the `metadata` field with validation results
4. Show progress after each batch

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
Trivia Question Validator

Opening database...
Found 61251 questions to validate

Processed 10/61251 questions
Processed 20/61251 questions
Processed 30/61251 questions
...
Processed 61251/61251 questions

Complete! Validated 61251 questions
```

## Troubleshooting

### "GEMINI_API_KEY environment variable must be set"
Set your API key:
```bash
export GEMINI_API_KEY="your-api-key-here"
```

### "Database file not found"
Ensure `questions.db` exists in the current directory where you're running the command.

### "Permission denied accessing database"
Check file permissions: `chmod 644 questions.db`

### Rate Limiting
The tool includes 100ms delays between API requests. If you hit rate limits, the Gemini API free tier allows:
- 15 requests per minute for gemini-2.0-flash-exp
- 1500 requests per day

For higher limits, consider upgrading to a paid plan.
