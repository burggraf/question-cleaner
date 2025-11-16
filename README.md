# Trivia Question Validator

Validates trivia questions in SQLite database using Google's Gemini Pro 2.5 model.

## Prerequisites

- Bun installed
- Google account with Gemini Pro subscription
- Google Cloud Project with OAuth2 credentials

## Setup

### 1. Create Google Cloud OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the "Generative Language API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Application type: "Desktop app"
6. Add authorized redirect URI: `http://localhost:8080/oauth2callback`
7. Download credentials JSON

### 2. Configure Application

Edit `validate-questions.ts` and replace:
- `OAUTH_CLIENT_ID` with your client ID
- `OAUTH_CLIENT_SECRET` with your client secret

### 3. Install Dependencies

```bash
bun install
```

## Usage

```bash
bun run validate-questions.ts
```

First run will:
1. Open browser for Google authentication
2. Request permission to access Gemini API
3. Save refresh token to `.gemini-auth.json`

Subsequent runs will use saved token automatically.

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

Starting OAuth2 authentication...
Please authenticate in your browser:
[URL]

Authentication successful!

Opening database...
Found 245 questions to validate

Processed 10/245 questions
Processed 20/245 questions
...
Processed 245/245 questions

Complete! Validated 245 questions
```
