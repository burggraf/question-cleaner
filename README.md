# Trivia Question Validator

Validates trivia questions in SQLite database using Google's Gemini 2.0 Flash model.

## Prerequisites

- **Bun** runtime installed
- **Google Cloud CLI (gcloud)** installed
- **Google account** with Gemini Pro subscription (or access to Gemini API)
- **Google Cloud Project** (free tier works)

## Setup

### 1. Install Google Cloud CLI

**macOS:**
```bash
brew install google-cloud-sdk
```

**Linux:**
```bash
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
```

**Windows:**
Download from: https://cloud.google.com/sdk/docs/install

Verify installation:
```bash
gcloud --version
```

### 2. Authenticate with gcloud

Run this command and log in with your Google account:

```bash
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/generative-language,https://www.googleapis.com/auth/cloud-platform
```

This will:
1. Open your browser
2. Ask you to log in with your Google account (use the one with Gemini access)
3. Grant permissions
4. Save credentials locally at `~/.config/gcloud/application_default_credentials.json`

### 3. Set up Google Cloud Project

```bash
# List existing projects
gcloud projects list

# If you don't have one, create it (choose a unique project ID):
gcloud projects create my-gemini-validator --name="Gemini Validator"

# Set as default
gcloud config set project my-gemini-validator
```

### 4. Enable the Generative Language API

```bash
gcloud services enable generativelanguage.googleapis.com
```

### 5. Install Dependencies

```bash
bun install
```

## Usage

```bash
bun run validate-questions.ts
```

The tool will:
1. Authenticate using your gcloud credentials (no browser needed after initial setup)
2. Connect to the SQLite database
3. Process questions in batches of 10
4. Update the `metadata` field with validation results
5. Show progress after each batch

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

Authenticating with Google Cloud credentials...
Authentication successful!

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

### "Google Cloud credentials not found"
Run the gcloud authentication command:
```bash
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/generative-language,https://www.googleapis.com/auth/cloud-platform
```

### "Request had insufficient authentication scopes"
Your credentials don't have the right scopes. Re-run the auth command with the scopes parameter:
```bash
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/generative-language,https://www.googleapis.com/auth/cloud-platform
```

### "Database file not found"
Ensure `questions.db` exists in the current directory where you're running the command.

### "Permission denied accessing database"
Check file permissions: `chmod 644 questions.db`
