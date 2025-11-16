# Trivia Question Validation Application Design

**Date:** 2025-11-15
**Purpose:** Validate trivia questions in SQLite database using Gemini Pro 2.5
**Runtime:** Bun + TypeScript

## Overview

A single-file TypeScript application that validates trivia questions from a SQLite database using Google's Gemini Pro 2.5 model. The tool processes questions in batches, checking for correctness, clarity, and quality issues, then tags problematic questions in the database.

## Requirements

### Inputs
- SQLite database: `questions.db` in current directory
- Table: `questions` with fields:
  - `id` (unique identifier)
  - `question` (question text)
  - `answer_a` (correct answer)
  - `answer_b`, `answer_c`, `answer_d` (incorrect answers)
  - `category`, `subcategory`
  - `difficulty` (easy/medium/hard)
  - `metadata` (validation tags - empty strings need processing)

### Validation Checks
- `INCORRECT`: Is answer_a truly correct?
- `AMBIGUOUS`: Is the question too ambiguous?
- `INCOMPLETE`: Is the question incomplete?
- `UNCLEAR`: Is the question unclear to average American adults?
- `OBVIOUS`: Is the answer spelled out in the question?
- `OVERDETAILED-ANSWER`: Does answer_a have unnecessary detail making it obvious?

### Outputs
- Updates `metadata` field with either:
  - `"OK"` if valid
  - Space-separated tags if issues found (e.g., `"AMBIGUOUS UNCLEAR"`)

## Architecture

### Monolithic Structure
Single TypeScript file containing:
1. OAuth2 authentication logic
2. SQLite database operations
3. Gemini API client
4. Validation prompt engineering
5. Main processing loop

### Processing Flow
```
1. Initialize OAuth2 → Authenticate user (one-time browser flow)
2. Load refresh token from .gemini-auth.json (or create if first run)
3. Connect to questions.db
4. Count questions with empty metadata
5. LOOP until no more empty metadata:
   - Query batch of 10 questions
   - FOR EACH question:
     * Call Gemini Pro 2.5 with validation prompt
     * Parse response
     * Update metadata field
   - Display progress
6. Display completion summary
```

## Authentication System

### OAuth2 Flow (First Run)
1. Check for `.gemini-auth.json`
2. If not found:
   - Start local HTTP server on `localhost:8080`
   - Open browser to Google OAuth consent screen
   - User authenticates with Gemini Pro account
   - Capture authorization code from redirect
   - Exchange for access + refresh tokens
   - Save refresh token to `.gemini-auth.json`
   - Shutdown server

### Token Management (Subsequent Runs)
1. Load refresh token from `.gemini-auth.json`
2. Exchange for fresh access token
3. If refresh fails: delete `.gemini-auth.json`, restart OAuth flow

### Token Storage Format
```json
{
  "refresh_token": "...",
  "token_type": "Bearer",
  "created_at": "2025-11-15T..."
}
```

## Gemini API Integration

### Endpoint
- API: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`
- Authentication: Bearer token in Authorization header
- Method: POST with JSON body

### Validation Prompt Template
```
You are validating a trivia question. Analyze this question and provide ONLY validation tags.

Question: {question}
Correct Answer: {answer_a}
Wrong Answers: {answer_b}, {answer_c}, {answer_d}
Category: {category} - {subcategory}
Difficulty: {difficulty}

Check for these issues:
- INCORRECT: Is answer_a actually correct?
- AMBIGUOUS: Is the question too ambiguous?
- INCOMPLETE: Is the question incomplete?
- UNCLEAR: Is the question unclear to average American adults?
- OBVIOUS: Is the answer spelled out in the question?
- OVERDETAILED-ANSWER: Does answer_a have unnecessary detail making it stand out?

Respond with ONLY:
- "OK" if no issues found
- Space-separated tags if issues found (e.g., "AMBIGUOUS UNCLEAR")
```

### Response Parsing
1. Extract text content from Gemini response JSON
2. Trim whitespace
3. Validate format (only allowed tags or "OK")
4. Return parsed metadata string

## Database Operations

### Batch Query (10 questions per batch)
```sql
SELECT * FROM questions
WHERE metadata = ''
LIMIT 10
```

### Update After Validation
```sql
UPDATE questions
SET metadata = ?
WHERE id = ?
```

### Initial Count
```sql
SELECT COUNT(*) FROM questions
WHERE metadata = ''
```

## Error Handling

**Stop and Report Policy:** Application halts immediately on any error.

### Error Cases
- HTTP/API errors (network, rate limits, auth failures)
- Invalid Gemini response format
- Database connection/query errors
- Token refresh failures

### Error Output
Display clear error message with context:
- What failed (API call, DB operation, etc.)
- Which question (if applicable)
- Error details

## Progress Display

### Minimal Output Format
```
Found 245 questions to validate
Processed 10/245 questions
Processed 20/245 questions
Processed 30/245 questions
...
Processed 245/245 questions
Complete! Validated 245 questions
```

### Progress Updates
- After each batch of 10 questions
- Single line with counter
- Final completion message

## Technology Stack

- **Runtime:** Bun (latest)
- **Language:** TypeScript
- **Database:** Bun's built-in `bun:sqlite` module
- **HTTP:** Bun's native `fetch`
- **OAuth:** Custom implementation with localhost redirect server
- **API:** Google Generative Language API (Gemini Pro 2.5)

## Configuration Files

### .gemini-auth.json (gitignored)
- Stores OAuth refresh token
- Created on first run
- Deleted if refresh fails (forces re-auth)

### questions.db
- User-provided SQLite database
- Must exist in current directory
- Application only reads/writes `metadata` field

## Design Decisions

1. **Monolithic vs Modular:** Chose monolithic for simplicity - this is a focused tool unlikely to need extension
2. **Batch Size (10 questions):** Balance between API call efficiency and error granularity
3. **Individual API Calls:** One question per call for clearer error attribution vs. batching multiple questions in one prompt
4. **Stop on Error:** Ensures data integrity - partial updates are visible before investigating failures
5. **OAuth vs API Key:** OAuth required per user constraint (Gemini Pro subscription, no API key)
6. **Minimal Output:** Clean progress tracking without verbose logging

## Success Criteria

- Processes all questions with empty metadata
- Correctly identifies validation issues per defined tags
- Updates database accurately with "OK" or issue tags
- Handles authentication transparently (one-time setup)
- Stops clearly on errors without corrupting data
- Shows progress without overwhelming output
