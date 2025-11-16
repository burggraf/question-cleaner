# Trivia Question Validator

Validates trivia questions in SQLite database using your **Gemini Pro subscription** via browser automation.

## Prerequisites

- **Bun** runtime installed
- **Google account** with Gemini Pro subscription
- **Chrome/Chromium** browser (Puppeteer will use this)

## How It Works

This tool automates the Gemini web interface at gemini.google.com to use your Pro subscription:
- Opens a browser window
- You log in to Gemini (one time)
- Automatically sends questions and parses responses
- Uses your unlimited Gemini Pro access (no API costs)

## Setup

### Install Dependencies

```bash
bun install
```

That's it! No API keys, no gcloud setup, no OAuth configuration needed.

## Usage

```bash
bun run validate-questions.ts
```

### What Happens

1. **Browser launches** - You'll see a Chrome window open
2. **Log in** - If it's your first run, log in to Gemini with your Pro account
3. **Wait for interface** - Once you see the Gemini chat, processing starts automatically
4. **Watch it work** - The browser will type questions and get responses
5. **Progress updates** - Terminal shows progress after each question

### Session Persistence

Your login session is saved in `./gemini-session/` directory, so you only need to log in once.

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
- `UNCLEAR` - Question is unclear
- `OBVIOUS` - Answer is in the question
- `OVERDETAILED-ANSWER` - Correct answer has too much detail

Multiple tags can appear space-separated.

## Output

```
Trivia Question Validator (Using Gemini Pro Subscription)

Launching browser...
Navigating to Gemini...

Please log in to Gemini if needed.
Once you see the Gemini chat interface, the tool will start.

Gemini interface ready!

Opening database...
Found 61251 questions to validate

Processed 1/61251 questions
Processed 2/61251 questions
...
```

## Performance

- **Speed:** ~3-5 seconds per question (slower than API but unlimited with Pro)
- **Cost:** $0 (uses your Pro subscription)
- **Time for 61,251 questions:** ~48-85 hours total runtime
- **Can be interrupted:** Safe to stop and resume anytime

## Tips

- **Keep the browser window visible** - Don't minimize it
- **Don't interact with the browser** - Let it run automatically
- **Safe to pause:** Press Ctrl+C anytime and resume later
- **Progress is saved:** Each question is saved to database immediately

## Troubleshooting

### Browser doesn't open
Make sure you have Chrome or Chromium installed. Puppeteer will download Chromium if needed.

### "Timeout waiting for chat interface"
Log in manually if the tool doesn't detect you're logged in. Once you see the chat input box, it will continue.

### "Database file not found"
Ensure `questions.db` exists in the current directory where you're running the command.

### Session expired
Delete the `./gemini-session/` directory and run again to log in fresh.
