# Jeopardy Questions Processor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Bun-based CLI that transforms 529,939 Jeopardy questions into multiple-choice format using Gemini 2.0 Flash API.

**Architecture:** Sequential single-threaded processor with SQLite database, Gemini API client, validation layer, and progress tracking. Processes 100 questions per batch with automatic resume capability.

**Tech Stack:** Bun runtime, bun:sqlite (built-in), Gemini 2.0 Flash API, TypeScript

---

## Task 1: Project Setup and Type Definitions

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`

**Step 1: Create type definitions**

Create `src/types.ts`:

```typescript
export interface Question {
  id: string;
  round: number;
  clue_value: number;
  daily_double_value: number;
  category: string;
  comments: string;
  question: string;
  a: string;
  b: string;
  c: string;
  d: string;
  air_date: string;
  notes: string;
  original_question: string;
  metadata: string;
}

export interface ProcessedQuestion {
  id: string;
  question: string;
  a: string;
  b: string;
  c: string;
  d: string;
  metadata?: string;
}

export interface Config {
  dbPath: string;
  batchSize: number;
  limit?: number;
  apiKey: string;
  delayMs: number;
}

export interface BatchStats {
  batchNumber: number;
  totalBatches: number;
  questionsProcessed: number;
  totalQuestions: number;
  failedBatches: number;
  startTime: number;
}
```

**Step 2: Create configuration**

Create `src/config.ts`:

```typescript
import { Config } from './types';

export function parseConfig(): Config {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  const args = process.argv.slice(2);
  const config: Config = {
    dbPath: './jeopardy.db',
    batchSize: 100,
    apiKey,
    delayMs: 2000,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      config.dbPath = args[i + 1];
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      config.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      config.limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return config;
}
```

**Step 3: Commit**

```bash
git add src/types.ts src/config.ts
git commit -m "feat: add type definitions and config parser"
```

---

## Task 2: Database Layer

**Files:**
- Create: `src/database.ts`
- Create: `test/database.test.ts`

**Step 1: Write the failing test**

Create `test/database.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseClient } from '../src/database';
import type { Question, ProcessedQuestion } from '../src/types';

describe('DatabaseClient', () => {
  let db: Database;
  let client: DatabaseClient;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        round INTEGER,
        clue_value INTEGER,
        daily_double_value INTEGER,
        category TEXT,
        comments TEXT,
        question TEXT,
        a TEXT,
        b TEXT,
        c TEXT,
        d TEXT,
        air_date TEXT,
        notes TEXT,
        original_question TEXT,
        metadata TEXT
      )
    `);
    client = new DatabaseClient(db);
  });

  afterEach(() => {
    db.close();
  });

  test('createIndexes creates required indexes', () => {
    client.createIndexes();
    const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index'").all();
    const indexNames = indexes.map((idx: any) => idx.name);
    expect(indexNames).toContain('idx_questions_b');
  });

  test('getUnprocessedBatch returns empty questions', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test2', 'Q2', 'A2', 'B2', 'C2', 'D2', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q2', '')`);

    const batch = client.getUnprocessedBatch(10);
    expect(batch.length).toBe(1);
    expect(batch[0].id).toBe('test1');
  });

  test('updateBatch updates multiple questions in transaction', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);

    const processed: ProcessedQuestion[] = [{
      id: 'test1',
      question: 'What is Q1?',
      a: 'A1',
      b: 'B1',
      c: 'C1',
      d: 'D1',
    }];

    client.updateBatch(processed);

    const result = db.query('SELECT * FROM questions WHERE id = ?').get('test1') as Question;
    expect(result.question).toBe('What is Q1?');
    expect(result.b).toBe('B1');
    expect(result.c).toBe('C1');
    expect(result.d).toBe('D1');
  });

  test('getTotalQuestions returns count', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);
    expect(client.getTotalQuestions()).toBe(1);
  });

  test('getUnprocessedCount returns count of empty b/c/d', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test2', 'Q2', 'A2', 'B2', 'C2', 'D2', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q2', '')`);
    expect(client.getUnprocessedCount()).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/database.test.ts`
Expected: FAIL with "Cannot find module '../src/database'"

**Step 3: Write minimal implementation**

Create `src/database.ts`:

```typescript
import { Database } from 'bun:sqlite';
import type { Question, ProcessedQuestion } from './types';

export class DatabaseClient {
  constructor(private db: Database) {}

  createIndexes(): void {
    this.db.run('CREATE INDEX IF NOT EXISTS idx_questions_b ON questions(b)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(b, c, d)');
  }

  getUnprocessedBatch(batchSize: number): Question[] {
    const query = this.db.query(`
      SELECT * FROM questions
      WHERE (b IS NULL OR b = '' OR b = ' ')
      LIMIT ?
    `);
    return query.all(batchSize) as Question[];
  }

  updateBatch(processed: ProcessedQuestion[]): void {
    const update = this.db.prepare(`
      UPDATE questions
      SET question = ?, a = ?, b = ?, c = ?, d = ?, metadata = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction((questions: ProcessedQuestion[]) => {
      for (const q of questions) {
        update.run(q.question, q.a, q.b, q.c, q.d, q.metadata || '', q.id);
      }
    });

    transaction(processed);
  }

  getTotalQuestions(): number {
    const result = this.db.query('SELECT COUNT(*) as count FROM questions').get() as { count: number };
    return result.count;
  }

  getUnprocessedCount(): number {
    const result = this.db.query(`
      SELECT COUNT(*) as count FROM questions
      WHERE (b IS NULL OR b = '' OR b = ' ')
    `).get() as { count: number };
    return result.count;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/database.test.ts`
Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add src/database.ts test/database.test.ts
git commit -m "feat: add database layer with batch operations"
```

---

## Task 3: Validator

**Files:**
- Create: `src/validator.ts`
- Create: `test/validator.test.ts`

**Step 1: Write the failing test**

Create `test/validator.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { Validator } from '../src/validator';
import type { ProcessedQuestion } from '../src/types';

describe('Validator', () => {
  const validator = new Validator();

  test('validates unique options', () => {
    const valid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
    };
    expect(validator.validate(valid)).toEqual({ valid: true });
  });

  test('rejects duplicate options', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer A',
      c: 'Answer C',
      d: 'Answer D',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not unique');
  });

  test('rejects empty options', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: '',
      c: 'Answer C',
      d: 'Answer D',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  test('rejects whitespace-only options', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: '   ',
      c: 'Answer C',
      d: 'Answer D',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  test('validates JSON metadata', () => {
    const valid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
      metadata: '{"issue": "test"}',
    };
    expect(validator.validate(valid)).toEqual({ valid: true });
  });

  test('rejects invalid JSON metadata', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
      metadata: '{invalid json}',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('metadata');
  });

  test('allows empty metadata', () => {
    const valid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
    };
    expect(validator.validate(valid)).toEqual({ valid: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/validator.test.ts`
Expected: FAIL with "Cannot find module '../src/validator'"

**Step 3: Write minimal implementation**

Create `src/validator.ts`:

```typescript
import type { ProcessedQuestion } from './types';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class Validator {
  validate(question: ProcessedQuestion): ValidationResult {
    // Check uniqueness
    const options = [question.a, question.b, question.c, question.d];
    const uniqueOptions = new Set(options);
    if (uniqueOptions.size !== 4) {
      return { valid: false, reason: `Options not unique for question ${question.id}` };
    }

    // Check non-empty
    for (const option of options) {
      if (!option || option.trim().length === 0) {
        return { valid: false, reason: `Empty option found for question ${question.id}` };
      }
    }

    // Check metadata JSON
    if (question.metadata) {
      try {
        JSON.parse(question.metadata);
      } catch {
        return { valid: false, reason: `Invalid JSON metadata for question ${question.id}` };
      }
    }

    return { valid: true };
  }

  validateBatch(questions: ProcessedQuestion[]): ValidationResult {
    for (const question of questions) {
      const result = this.validate(question);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/validator.test.ts`
Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add src/validator.ts test/validator.test.ts
git commit -m "feat: add validator for processed questions"
```

---

## Task 4: Gemini API Client

**Files:**
- Create: `src/gemini.ts`
- Create: `test/gemini.test.ts`

**Step 1: Write the failing test**

Create `test/gemini.test.ts`:

```typescript
import { describe, test, expect, mock } from 'bun:test';
import { GeminiClient } from '../src/gemini';
import type { Question } from '../src/types';

describe('GeminiClient', () => {
  test('buildPrompt creates proper JSON request', () => {
    const client = new GeminiClient('fake-key');
    const questions: Question[] = [{
      id: 'test1',
      question: 'River mentioned most often in the Bible',
      a: 'the Jordan',
      b: '', c: '', d: '',
      category: 'LAKES & RIVERS',
      air_date: '1984-09-10',
      round: 1,
      clue_value: 100,
      daily_double_value: 0,
      comments: '',
      notes: '',
      original_question: 'River mentioned most often in the Bible',
      metadata: '',
    }];

    const prompt = client.buildPrompt(questions);
    expect(prompt).toContain('River mentioned most often in the Bible');
    expect(prompt).toContain('the Jordan');
    expect(prompt).toContain('LAKES & RIVERS');
    expect(prompt).toContain('1984-09-10');
  });

  test('parseResponse extracts JSON from markdown', () => {
    const client = new GeminiClient('fake-key');
    const response = '```json\n[{"id":"test1","question":"What is X?","a":"A","b":"B","c":"C","d":"D"}]\n```';
    const result = client.parseResponse(response);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test1');
  });

  test('parseResponse handles plain JSON', () => {
    const client = new GeminiClient('fake-key');
    const response = '[{"id":"test1","question":"What is X?","a":"A","b":"B","c":"C","d":"D"}]';
    const result = client.parseResponse(response);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test1');
  });

  test('parseResponse throws on invalid JSON', () => {
    const client = new GeminiClient('fake-key');
    expect(() => client.parseResponse('not json')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/gemini.test.ts`
Expected: FAIL with "Cannot find module '../src/gemini'"

**Step 3: Write minimal implementation**

Create `src/gemini.ts`:

```typescript
import type { Question, ProcessedQuestion } from './types';

export class GeminiClient {
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

  constructor(private apiKey: string) {}

  buildPrompt(questions: Question[]): string {
    const systemPrompt = `You are a quiz question formatter. Convert Jeopardy-style clues into proper multiple-choice questions.

REQUIREMENTS:
1. Reword the question to be in question form (not answer form)
2. Keep the answer in field 'a' correct
3. If the answer is outdated or incorrect (time has passed), update field 'a' and add metadata: {"issue": "explanation"}
4. Generate 3 plausible but clearly incorrect distractors for b, c, d
5. If question is ambiguous, unclear, or problematic, add metadata: {"ambiguous": "reason"}
6. Return ONLY a JSON array, no additional text

OUTPUT FORMAT:
[
  {
    "id": "question_id",
    "question": "Properly formatted question?",
    "a": "Correct answer",
    "b": "Plausible distractor 1",
    "c": "Plausible distractor 2",
    "d": "Plausible distractor 3",
    "metadata": "Optional JSON string if issues found"
  }
]

QUESTIONS:
`;

    const questionsText = questions.map(q =>
      `ID: ${q.id}\nCategory: ${q.category}\nAir Date: ${q.air_date}\nClue: ${q.question}\nAnswer: ${q.a}`
    ).join('\n\n');

    return systemPrompt + questionsText;
  }

  parseResponse(response: string): ProcessedQuestion[] {
    // Remove markdown code blocks if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    return JSON.parse(cleaned);
  }

  async processBatch(questions: Question[]): Promise<ProcessedQuestion[]> {
    const prompt = this.buildPrompt(questions);

    const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response structure from Gemini API');
    }

    const text = data.candidates[0].content.parts[0].text;
    return this.parseResponse(text);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/gemini.test.ts`
Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add src/gemini.ts test/gemini.test.ts
git commit -m "feat: add Gemini API client"
```

---

## Task 5: Progress Tracker

**Files:**
- Create: `src/progress.ts`
- Create: `src/logger.ts`

**Step 1: Write progress tracker**

Create `src/progress.ts`:

```typescript
import type { BatchStats } from './types';

export class ProgressTracker {
  private stats: BatchStats;

  constructor(
    totalQuestions: number,
    unprocessedCount: number,
    batchSize: number
  ) {
    this.stats = {
      batchNumber: 0,
      totalBatches: Math.ceil(unprocessedCount / batchSize),
      questionsProcessed: totalQuestions - unprocessedCount,
      totalQuestions,
      failedBatches: 0,
      startTime: Date.now(),
    };
  }

  startBatch(): void {
    this.stats.batchNumber++;
  }

  completeBatch(questionsInBatch: number): void {
    this.stats.questionsProcessed += questionsInBatch;
  }

  failBatch(): void {
    this.stats.failedBatches++;
  }

  getProgress(): string {
    const percent = Math.round((this.stats.batchNumber / this.stats.totalBatches) * 100);
    const elapsed = Date.now() - this.stats.startTime;
    const avgTimePerBatch = elapsed / this.stats.batchNumber;
    const remainingBatches = this.stats.totalBatches - this.stats.batchNumber;
    const etaMs = avgTimePerBatch * remainingBatches;
    const eta = this.formatTime(etaMs);

    return `Batch ${this.stats.batchNumber}/${this.stats.totalBatches} (${percent}%) | ` +
           `${this.stats.questionsProcessed.toLocaleString()}/${this.stats.totalQuestions.toLocaleString()} questions | ` +
           `${this.stats.failedBatches} failed | ` +
           `ETA: ${eta}`;
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getSummary(): string {
    const elapsed = this.formatTime(Date.now() - this.stats.startTime);
    return `\nProcessing complete!\n` +
           `Processed: ${this.stats.questionsProcessed.toLocaleString()} questions\n` +
           `Failed batches: ${this.stats.failedBatches}\n` +
           `Time: ${elapsed}`;
  }
}
```

**Step 2: Write logger**

Create `src/logger.ts`:

```typescript
import { appendFileSync } from 'fs';

export class Logger {
  constructor(
    private processingLog = 'processing.log',
    private failedLog = 'failed-batches.log'
  ) {}

  logBatch(batchNumber: number, questionIds: string[]): void {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] Batch ${batchNumber}: Processing ${questionIds.length} questions (${questionIds[0]} - ${questionIds[questionIds.length - 1]})\n`;
    appendFileSync(this.processingLog, message);
  }

  logError(batchNumber: number, questionIds: string[], error: string, rawResponse?: string): void {
    const timestamp = new Date().toISOString();
    let message = `[${timestamp}] Batch ${batchNumber} FAILED\n`;
    message += `Question IDs: ${questionIds.join(', ')}\n`;
    message += `Error: ${error}\n`;
    if (rawResponse) {
      message += `Raw response: ${rawResponse}\n`;
    }
    message += '---\n';

    appendFileSync(this.failedLog, message);
    appendFileSync(this.processingLog, message);
  }

  logValidationError(batchNumber: number, questionIds: string[], reason: string): void {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] Batch ${batchNumber} VALIDATION FAILED: ${reason}\n`;
    appendFileSync(this.failedLog, message);
    appendFileSync(this.processingLog, message);
  }

  logInfo(message: string): void {
    const timestamp = new Date().toISOString();
    appendFileSync(this.processingLog, `[${timestamp}] ${message}\n`);
  }
}
```

**Step 3: Commit**

```bash
git add src/progress.ts src/logger.ts
git commit -m "feat: add progress tracker and logger"
```

---

## Task 6: Main Processor

**Files:**
- Create: `src/processor.ts`

**Step 1: Write main processor**

Create `src/processor.ts`:

```typescript
import { Database } from 'bun:sqlite';
import { DatabaseClient } from './database';
import { GeminiClient } from './gemini';
import { Validator } from './validator';
import { ProgressTracker } from './progress';
import { Logger } from './logger';
import type { Config } from './types';

export class QuestionProcessor {
  private db: DatabaseClient;
  private gemini: GeminiClient;
  private validator: Validator;
  private logger: Logger;

  constructor(private config: Config) {
    const database = new Database(config.dbPath);
    this.db = new DatabaseClient(database);
    this.gemini = new GeminiClient(config.apiKey);
    this.validator = new Validator();
    this.logger = new Logger();
  }

  async run(): Promise<void> {
    console.log('Initializing database...');
    this.db.createIndexes();

    const totalQuestions = this.db.getTotalQuestions();
    const unprocessedCount = this.db.getUnprocessedCount();

    console.log(`Total questions: ${totalQuestions.toLocaleString()}`);
    console.log(`Unprocessed questions: ${unprocessedCount.toLocaleString()}`);

    if (unprocessedCount === 0) {
      console.log('No questions to process!');
      return;
    }

    const batchesToProcess = this.config.limit || Math.ceil(unprocessedCount / this.config.batchSize);
    console.log(`Will process ${batchesToProcess} batches\n`);

    const progress = new ProgressTracker(totalQuestions, unprocessedCount, this.config.batchSize);

    for (let i = 0; i < batchesToProcess; i++) {
      progress.startBatch();

      const batch = this.db.getUnprocessedBatch(this.config.batchSize);
      if (batch.length === 0) {
        console.log('No more unprocessed questions');
        break;
      }

      const questionIds = batch.map(q => q.id);
      this.logger.logBatch(progress['stats'].batchNumber, questionIds);

      try {
        // Process with Gemini
        const processed = await this.gemini.processBatch(batch);

        // Validate response
        if (processed.length !== batch.length) {
          throw new Error(`Expected ${batch.length} questions, got ${processed.length}`);
        }

        const validationResult = this.validator.validateBatch(processed);
        if (!validationResult.valid) {
          this.logger.logValidationError(
            progress['stats'].batchNumber,
            questionIds,
            validationResult.reason!
          );
          progress.failBatch();
          console.log(`${progress.getProgress()} - VALIDATION FAILED`);
        } else {
          // Update database
          this.db.updateBatch(processed);
          progress.completeBatch(batch.length);
          console.log(progress.getProgress());
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check for fatal errors
        if (
          errorMessage.includes('429') ||
          errorMessage.includes('5') && errorMessage.includes('status') ||
          errorMessage.includes('network') ||
          errorMessage.includes('ECONNREFUSED')
        ) {
          console.error(`\n\nFATAL ERROR: ${errorMessage}`);
          console.error('Stopping processing due to infrastructure issue.\n');
          this.logger.logError(progress['stats'].batchNumber, questionIds, errorMessage);
          process.exit(1);
        }

        // Non-fatal error: log and continue
        this.logger.logError(
          progress['stats'].batchNumber,
          questionIds,
          errorMessage
        );
        progress.failBatch();
        console.log(`${progress.getProgress()} - ERROR: ${errorMessage}`);
      }

      // Delay between batches
      if (i < batchesToProcess - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.delayMs));
      }
    }

    console.log(progress.getSummary());
    this.logger.logInfo('Processing complete');
  }
}
```

**Step 2: Commit**

```bash
git add src/processor.ts
git commit -m "feat: add main processor with error handling"
```

---

## Task 7: CLI Entry Point

**Files:**
- Create: `index.ts`

**Step 1: Write CLI entry point**

Create `index.ts`:

```typescript
import { parseConfig } from './src/config';
import { QuestionProcessor } from './src/processor';

async function main() {
  try {
    const config = parseConfig();
    const processor = new QuestionProcessor(config);
    await processor.run();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
```

**Step 2: Update package.json**

Modify `package.json` to add the main script:

```json
{
  "name": "questions",
  "module": "index.ts",
  "type": "module",
  "scripts": {
    "start": "bun run index.ts",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.9.3"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "google-auth-library": "^10.5.0",
    "puppeteer": "^24.30.0"
  }
}
```

**Step 3: Create .env.example**

Create `.env.example`:

```
GEMINI_API_KEY=your_api_key_here
```

**Step 4: Commit**

```bash
git add index.ts package.json .env.example
git commit -m "feat: add CLI entry point and scripts"
```

---

## Task 8: Create README

**Files:**
- Create: `README.md`

**Step 1: Write README**

Create `README.md`:

```markdown
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
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage instructions"
```

---

## Task 9: Integration Test

**Files:**
- Create: `test/integration.test.ts`

**Step 1: Write integration test**

Create `test/integration.test.ts`:

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseClient } from '../src/database';
import type { Question } from '../src/types';

describe('Integration Test', () => {
  let db: Database;
  let client: DatabaseClient;

  beforeAll(() => {
    // Create in-memory test database
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        round INTEGER,
        clue_value INTEGER,
        daily_double_value INTEGER,
        category TEXT,
        comments TEXT,
        question TEXT,
        a TEXT,
        b TEXT,
        c TEXT,
        d TEXT,
        air_date TEXT,
        notes TEXT,
        original_question TEXT,
        metadata TEXT
      )
    `);

    // Insert test data
    db.run(`
      INSERT INTO questions VALUES
      ('test1', 1, 100, 0, 'GEOGRAPHY', '', 'Largest ocean on Earth', 'Pacific Ocean', '', '', '', '2020-01-01', '', 'Largest ocean on Earth', ''),
      ('test2', 1, 200, 0, 'HISTORY', '', 'Year World War II ended', '1945', '', '', '', '2020-01-02', '', 'Year World War II ended', ''),
      ('test3', 1, 300, 0, 'SCIENCE', '', 'Symbol for gold', 'Au', 'Gold', 'G', 'Go', '2020-01-03', '', 'Symbol for gold', '')
    `);

    client = new DatabaseClient(db);
  });

  test('end-to-end: indexes, query, update flow', () => {
    // Create indexes
    client.createIndexes();

    // Get unprocessed count (only test1 and test2 have empty b/c/d)
    const unprocessed = client.getUnprocessedCount();
    expect(unprocessed).toBe(2);

    // Get batch
    const batch = client.getUnprocessedBatch(10);
    expect(batch.length).toBe(2);

    // Update batch
    client.updateBatch([
      {
        id: 'test1',
        question: 'What is the largest ocean on Earth?',
        a: 'Pacific Ocean',
        b: 'Atlantic Ocean',
        c: 'Indian Ocean',
        d: 'Arctic Ocean',
      },
      {
        id: 'test2',
        question: 'In what year did World War II end?',
        a: '1945',
        b: '1944',
        c: '1946',
        d: '1943',
      },
    ]);

    // Verify updates
    const updated = db.query('SELECT * FROM questions WHERE id = ?').get('test1') as Question;
    expect(updated.question).toBe('What is the largest ocean on Earth?');
    expect(updated.b).toBe('Atlantic Ocean');

    // Verify no more unprocessed
    const remaining = client.getUnprocessedCount();
    expect(remaining).toBe(0);
  });
});
```

**Step 2: Run integration test**

Run: `bun test test/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/integration.test.ts
git commit -m "test: add integration test for end-to-end flow"
```

---

## Task 10: Final Verification

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Verify project structure**

Run: `ls -la`
Expected output should include:
- `index.ts`
- `src/` directory with all modules
- `test/` directory with all tests
- `README.md`
- `.env.example`
- `package.json`

**Step 3: Test CLI help (dry run)**

Since we don't have a real database yet, just verify the config parser works:

Run: `bun run index.ts --help 2>&1 || true`
Expected: Error about missing GEMINI_API_KEY (proves config parser runs)

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final verification complete"
```

---

## Execution Notes

**Before running on real data:**

1. Set `GEMINI_API_KEY` environment variable
2. Ensure `jeopardy.db` exists in project root
3. Start with `--limit 1` to test first batch
4. Review output and first 100 questions in database
5. Then run `--limit 10` for larger test
6. Finally run without limit for full processing

**If processing is interrupted:**

Simply restart the application - it will automatically pick up from where it left off by querying for questions with empty b/c/d fields.

**Monitoring:**

- Watch console for real-time progress
- Check `processing.log` for detailed activity
- Check `failed-batches.log` for any batches that need manual review

---

## Dependencies

All required dependencies are already in `package.json`:
- `bun:sqlite` (built-in)
- `bun:test` (built-in)
- TypeScript for type checking

No additional installations needed beyond `bun install`.
