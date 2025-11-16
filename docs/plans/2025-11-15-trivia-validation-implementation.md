# Trivia Question Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Bun/TypeScript application that validates trivia questions in SQLite database using Gemini Pro 2.5 via OAuth2.

**Architecture:** Monolithic single-file script with OAuth2 authentication, SQLite database operations, Gemini API integration, and batch processing loop.

**Tech Stack:** Bun, TypeScript, bun:sqlite, Google OAuth2, Generative Language API (Gemini Pro 2.5)

---

## Task 1: Project Setup and Dependencies

**Files:**
- Create: `validate-questions.ts`
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`

**Step 1: Initialize Bun project**

Run: `bun init -y`
Expected: Creates package.json

**Step 2: Create TypeScript config**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

**Step 3: Create .gitignore**

Create `.gitignore`:
```
node_modules/
.gemini-auth.json
*.db
.DS_Store
```

**Step 4: Create initial validate-questions.ts**

Create `validate-questions.ts`:
```typescript
#!/usr/bin/env bun

/**
 * Trivia Question Validation Tool
 * Validates questions in SQLite database using Gemini Pro 2.5
 */

console.log("Trivia Question Validator - Starting...");
```

**Step 5: Test initial setup**

Run: `bun run validate-questions.ts`
Expected: "Trivia Question Validator - Starting..."

**Step 6: Make file executable**

Run: `chmod +x validate-questions.ts`

**Step 7: Commit**

```bash
git init
git add .
git commit -m "feat: initialize project structure"
```

---

## Task 2: OAuth2 Token Storage Interface

**Files:**
- Modify: `validate-questions.ts`

**Step 1: Add token storage types and functions**

Add to `validate-questions.ts` after console.log:
```typescript
// Types
interface TokenStorage {
  refresh_token: string;
  token_type: string;
  created_at: string;
}

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// Constants
const TOKEN_FILE = ".gemini-auth.json";
const OAUTH_CLIENT_ID = "YOUR_CLIENT_ID"; // TODO: Replace with actual client ID
const OAUTH_CLIENT_SECRET = "YOUR_CLIENT_SECRET"; // TODO: Replace with actual secret
const OAUTH_REDIRECT_URI = "http://localhost:8080/oauth2callback";
const OAUTH_SCOPES = "https://www.googleapis.com/auth/generative-language.retriever";

// Token storage functions
function loadTokenStorage(): TokenStorage | null {
  try {
    const file = Bun.file(TOKEN_FILE);
    return file.size > 0 ? JSON.parse(await file.text()) : null;
  } catch {
    return null;
  }
}

function saveTokenStorage(tokens: TokenStorage): void {
  Bun.write(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function deleteTokenStorage(): void {
  try {
    const fs = require("fs");
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    // File doesn't exist, ignore
  }
}
```

**Step 2: Fix async function issue**

Change `loadTokenStorage` to async:
```typescript
async function loadTokenStorage(): Promise<TokenStorage | null> {
  try {
    const file = Bun.file(TOKEN_FILE);
    if (!(await file.exists())) return null;
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function saveTokenStorage(tokens: TokenStorage): Promise<void> {
  await Bun.write(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}
```

**Step 3: Test compilation**

Run: `bun run validate-questions.ts`
Expected: No TypeScript errors, same output as before

**Step 4: Commit**

```bash
git add validate-questions.ts
git commit -m "feat: add OAuth2 token storage interface"
```

---

## Task 3: OAuth2 Authentication Flow

**Files:**
- Modify: `validate-questions.ts`

**Step 1: Add OAuth2 server and authentication logic**

Add before the final console.log:
```typescript
// OAuth2 helper functions
function startLocalServer(): Promise<{ server: any; codePromise: Promise<string> }> {
  let resolveCode: (code: string) => void;
  const codePromise = new Promise<string>((resolve) => {
    resolveCode = resolve;
  });

  const server = Bun.serve({
    port: 8080,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/oauth2callback") {
        const code = url.searchParams.get("code");
        if (code) {
          resolveCode(code);
          return new Response("Authentication successful! You can close this window.", {
            headers: { "Content-Type": "text/html" },
          });
        }
        return new Response("Authentication failed - no code received", { status: 400 });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  return Promise.resolve({ server, codePromise });
}

async function exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return await response.json();
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error("Refresh token expired or invalid");
  }

  const data = await response.json();
  return data.access_token;
}

async function authenticate(): Promise<string> {
  // Check for existing token
  const stored = await loadTokenStorage();
  if (stored) {
    console.log("Found existing authentication...");
    try {
      const accessToken = await refreshAccessToken(stored.refresh_token);
      console.log("Authentication refreshed successfully");
      return accessToken;
    } catch (error) {
      console.log("Refresh failed, re-authenticating...");
      deleteTokenStorage();
    }
  }

  // Start OAuth flow
  console.log("Starting OAuth2 authentication...");
  const { server, codePromise } = await startLocalServer();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", OAUTH_SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log(`\nPlease authenticate in your browser:`);
  console.log(authUrl.toString());
  console.log("\nOpening browser...\n");

  // Open browser (macOS)
  Bun.spawn(["open", authUrl.toString()]);

  // Wait for callback
  const code = await codePromise;
  server.stop();

  // Exchange code for tokens
  console.log("Exchanging authorization code for tokens...");
  const tokens = await exchangeCodeForTokens(code);

  // Save refresh token
  await saveTokenStorage({
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    created_at: new Date().toISOString(),
  });

  console.log("Authentication successful!\n");
  return tokens.access_token;
}
```

**Step 2: Test compilation**

Run: `bun run validate-questions.ts`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add validate-questions.ts
git commit -m "feat: implement OAuth2 authentication flow"
```

---

## Task 4: Database Interface

**Files:**
- Modify: `validate-questions.ts`

**Step 1: Add database types and functions**

Add after OAuth functions:
```typescript
import { Database } from "bun:sqlite";

// Database types
interface Question {
  id: string;
  question: string;
  answer_a: string;
  answer_b: string;
  answer_c: string;
  answer_d: string;
  category: string;
  subcategory: string;
  difficulty: string;
  metadata: string;
}

// Database functions
function openDatabase(): Database {
  const db = new Database("questions.db");
  return db;
}

function getUnvalidatedCount(db: Database): number {
  const result = db.query("SELECT COUNT(*) as count FROM questions WHERE metadata = ''").get() as { count: number };
  return result.count;
}

function getNextBatch(db: Database, batchSize: number): Question[] {
  const query = db.query("SELECT * FROM questions WHERE metadata = '' LIMIT ?");
  return query.all(batchSize) as Question[];
}

function updateMetadata(db: Database, id: string, metadata: string): void {
  const query = db.query("UPDATE questions SET metadata = ? WHERE id = ?");
  query.run(metadata, id);
}
```

**Step 2: Test compilation**

Run: `bun run validate-questions.ts`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add validate-questions.ts
git commit -m "feat: add database interface functions"
```

---

## Task 5: Gemini API Client

**Files:**
- Modify: `validate-questions.ts`

**Step 1: Add Gemini API constants and validation function**

Add after database functions:
```typescript
// Gemini API
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

function buildValidationPrompt(q: Question): string {
  return `You are validating a trivia question. Analyze this question and provide ONLY validation tags.

Question: ${q.question}
Correct Answer: ${q.answer_a}
Wrong Answers: ${q.answer_b}, ${q.answer_c}, ${q.answer_d}
Category: ${q.category} - ${q.subcategory}
Difficulty: ${q.difficulty}

Check for these issues:
- INCORRECT: Is answer_a actually correct?
- AMBIGUOUS: Is the question too ambiguous?
- INCOMPLETE: Is the question incomplete?
- UNCLEAR: Is the question unclear to average American adults?
- OBVIOUS: Is the answer spelled out in the question?
- OVERDETAILED-ANSWER: Does answer_a have unnecessary detail making it stand out?

Respond with ONLY:
- "OK" if no issues found
- Space-separated tags if issues found (e.g., "AMBIGUOUS UNCLEAR")`;
}

async function validateQuestion(q: Question, accessToken: string): Promise<string> {
  const prompt = buildValidationPrompt(q);

  const response = await fetch(GEMINI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 50,
      }
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Extract text from response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Invalid response format from Gemini");
  }

  return text.trim();
}
```

**Step 2: Test compilation**

Run: `bun run validate-questions.ts`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add validate-questions.ts
git commit -m "feat: implement Gemini API client for validation"
```

---

## Task 6: Main Processing Loop

**Files:**
- Modify: `validate-questions.ts`

**Step 1: Replace console.log with main function**

Replace the final `console.log("Trivia Question Validator - Starting...");` with:
```typescript
// Main execution
async function main() {
  console.log("Trivia Question Validator\n");

  try {
    // Authenticate
    const accessToken = await authenticate();

    // Open database
    console.log("Opening database...");
    const db = openDatabase();

    // Get total count
    const totalCount = getUnvalidatedCount(db);
    if (totalCount === 0) {
      console.log("No questions to validate. All done!");
      db.close();
      return;
    }

    console.log(`Found ${totalCount} questions to validate\n`);

    // Process batches
    let processed = 0;
    const batchSize = 10;

    while (true) {
      const batch = getNextBatch(db, batchSize);
      if (batch.length === 0) break;

      for (const question of batch) {
        try {
          const result = await validateQuestion(question, accessToken);
          updateMetadata(db, question.id, result);
          processed++;
        } catch (error) {
          console.error(`\nError validating question ${question.id}:`);
          console.error(error instanceof Error ? error.message : String(error));
          db.close();
          process.exit(1);
        }
      }

      console.log(`Processed ${processed}/${totalCount} questions`);
    }

    console.log(`\nComplete! Validated ${totalCount} questions`);
    db.close();

  } catch (error) {
    console.error("\nFatal error:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run
main();
```

**Step 2: Test compilation**

Run: `bun run validate-questions.ts`
Expected: Should attempt to run (may fail on OAuth if not configured)

**Step 3: Commit**

```bash
git add validate-questions.ts
git commit -m "feat: implement main processing loop"
```

---

## Task 7: OAuth Configuration Instructions

**Files:**
- Create: `README.md`

**Step 1: Create README with setup instructions**

Create `README.md`:
```markdown
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
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add setup and usage instructions"
```

---

## Task 8: Final Testing and Verification

**Files:**
- Test: `validate-questions.ts`

**Step 1: Verify OAuth configuration needed**

Review `validate-questions.ts` lines with `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET`

**Note for user:** Before first run, you must:
1. Create Google Cloud OAuth2 credentials
2. Update OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in code

**Step 2: Verify database exists**

Run: `ls questions.db`
Expected: File exists in current directory

**Step 3: Check sample questions have empty metadata**

Run: `echo "SELECT COUNT(*) FROM questions WHERE metadata = '';" | bun:sqlite questions.db`
Expected: Count > 0

**Step 4: Dry run test (will fail on auth if not configured)**

Run: `bun run validate-questions.ts`
Expected: Starts, shows authentication prompt (if OAuth configured) or error about credentials

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: finalize validation tool v1"
```

---

## Post-Implementation Notes

### Known Limitations
1. OAuth credentials must be manually configured (OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET)
2. Batch size is hardcoded to 10
3. No retry logic for transient API failures (stop-on-error by design)
4. macOS-specific browser opening command (`open`)

### Future Enhancements
- Environment variables for OAuth credentials
- Configurable batch size
- Cross-platform browser opening
- Optional verbose mode
- Dry-run mode for testing prompts

### Testing Checklist
- [ ] OAuth flow completes successfully
- [ ] Refresh token saves and reloads correctly
- [ ] Database queries return correct questions
- [ ] Gemini API calls work with Bearer token
- [ ] Metadata updates persist to database
- [ ] Progress counter displays correctly
- [ ] Error handling stops on first error
- [ ] Final count matches total processed

---

## Verification Commands

After implementation:

```bash
# Check TypeScript compilation
bun run validate-questions.ts --dry-run

# Verify database structure
echo ".schema questions" | bun x --bun sqlite3 questions.db

# Count unvalidated questions
echo "SELECT COUNT(*) FROM questions WHERE metadata = '';" | bun x --bun sqlite3 questions.db

# Sample first 5 unvalidated
echo "SELECT id, question, answer_a FROM questions WHERE metadata = '' LIMIT 5;" | bun x --bun sqlite3 questions.db
```
