# Jeopardy Questions Processor

Transforms Jeopardy questions into multiple-choice format using Gemini 2.0 Flash API.

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Set your Gemini API key:
   ```bash
   export GEMINI_API_KEY='your-api-key'
   ```

3. Make sure `jeopardy.db` is in the project root

## Usage

Process all questions:
```bash
bun start
```

Test with first 10 batches (1000 questions):
```bash
bun start --limit 10
```

Custom database path:
```bash
bun start --db /path/to/database.db
```

Custom batch size:
```bash
bun start --batch-size 50
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

1. Queries database for questions with empty b, c, d fields
2. Processes in batches of 100 questions
3. Sends each batch to Gemini 2.0 Flash API
4. Validates responses (unique options, no empties, valid JSON metadata)
5. Updates database with processed questions
6. Automatically resumes from where it left off after crashes

## Error Handling

**Fatal errors (stops processing):**
- Network errors
- Rate limits (429)
- Server errors (5xx)

**Non-fatal errors (logs and continues):**
- Invalid JSON responses
- Validation failures
- Partial batch responses

## Performance

- ~5,300 batches for full dataset (529,939 questions)
- ~3-5 seconds per batch
- Total time: 4-5 hours
