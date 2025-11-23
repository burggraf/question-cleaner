#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { existsSync, writeFileSync, appendFileSync } from 'fs';
import { $ } from 'bun';

interface QuestionToClean {
  id: string;
  original_question: string;
  question: string;
  a: string;
  b: string;
  c: string;
  d: string;
  metadata: string;
}

interface GeminiResponse {
  question: string;
  a: string;
  b: string;
  c: string;
  d: string;
  leave_unchanged?: boolean;
  reason?: string;
}

class QuestionCleanup {
  private db: Database;
  private processed = 0;
  private queueSize = 0;
  private skipped = 0;
  private updated = 0;
  private logFile = 'cleanup-questions.log';
  private startTime = 0;

  constructor(dbPath: string) {
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found: ${dbPath}`);
    }
    this.db = new Database(dbPath);

    // Initialize log file with header
    const timestamp = new Date().toISOString();
    writeFileSync(this.logFile, `=== Question Cleanup Log - Started ${timestamp} ===\n\n`);
  }

  /**
   * Format time in human-readable format
   */
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

  /**
   * Calculate and display estimated time remaining
   */
  private getEstimatedTimeRemaining(): string {
    if (this.processed === 0) return 'calculating...';

    const elapsed = Date.now() - this.startTime;
    const avgTimePerQuestion = elapsed / this.processed;
    const remaining = this.queueSize - this.processed;
    const estimatedMs = remaining * avgTimePerQuestion;

    return this.formatTime(estimatedMs);
  }

  /**
   * Log a change to the audit file
   */
  logChange(question: QuestionToClean, response: GeminiResponse): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      id: question.id,
      before: {
        question: question.question,
        a: question.a,
        b: question.b,
        c: question.c,
        d: question.d
      },
      after: {
        question: response.question,
        a: response.a,
        b: response.b,
        c: response.c,
        d: response.d
      }
    };

    const logText = `
${'='.repeat(80)}
ID: ${logEntry.id}
Timestamp: ${logEntry.timestamp}
${'='.repeat(80)}

BEFORE:
Q: ${logEntry.before.question}
A: ${logEntry.before.a}
B: ${logEntry.before.b}
C: ${logEntry.before.c}
D: ${logEntry.before.d}

AFTER:
Q: ${logEntry.after.question}
A: ${logEntry.after.a}
B: ${logEntry.after.b}
C: ${logEntry.after.c}
D: ${logEntry.after.d}

`;

    appendFileSync(this.logFile, logText);
  }

  /**
   * Build the queue of questions that contain "clue" or "air date"
   */
  buildQueue(): string[] {
    console.log('\n🔍 Building queue of questions to review...\n');

    // Search for questions containing "clue" or "air date" in the current question field (case insensitive)
    // We only check the 'question' field, not 'original_question', since we care about what users will see
    const query = this.db.query(`
      SELECT id FROM questions
      WHERE LOWER(question) LIKE '%clue%'
         OR LOWER(question) LIKE '%air date%'
    `);

    const results = query.all() as Array<{ id: string }>;
    const ids = results.map(r => r.id);

    this.queueSize = ids.length;
    console.log(`📋 Found ${this.queueSize} questions to review\n`);

    return ids;
  }

  /**
   * Get a question by ID
   */
  getQuestion(id: string): QuestionToClean | null {
    const query = this.db.query(`
      SELECT id, original_question, question, a, b, c, d, metadata
      FROM questions
      WHERE id = ?
    `);

    return query.get(id) as QuestionToClean | null;
  }

  /**
   * Build the prompt for Gemini
   */
  buildPrompt(question: QuestionToClean): string {
    return `You are reviewing a Jeopardy trivia question that may have issues. The question either:
1. Contains the word "clue" inserted awkwardly by an AI (making it incomplete or confusing)
2. Contains "air date" references that make the question time-dependent or outdated
3. Is actually fine and should be left unchanged (e.g., legitimately references the board game "Clue" or uses these words naturally)

ORIGINAL QUESTION: ${question.original_question || question.question}
CURRENT QUESTION: ${question.question}
CORRECT ANSWER (A): ${question.a}
WRONG ANSWER (B): ${question.b}
WRONG ANSWER (C): ${question.c}
WRONG ANSWER (D): ${question.d}

YOUR TASK:
- If the question is VALID and doesn't have issues, respond with: {"leave_unchanged": true, "reason": "brief explanation"}
- If the question needs fixing, create an updated version that:
  * Removes awkward "clue" references (unless it's about the board game Clue or legitimately uses the word)
  * Updates time-dependent information to be current and accurate
  * Keeps the question clear and makes sense without Jeopardy context
  * Maintains the same difficulty level
  * Ensures answer A is correct, and B/C/D are plausible but wrong

IMPORTANT: Players don't know this was a Jeopardy clue. Make it work as a standalone trivia question.

Respond with ONLY valid JSON in this format:
{
  "leave_unchanged": false,
  "question": "Updated question text?",
  "a": "Correct answer",
  "b": "Plausible wrong answer 1",
  "c": "Plausible wrong answer 2",
  "d": "Plausible wrong answer 3"
}

OR if no changes needed:
{
  "leave_unchanged": true,
  "reason": "Question legitimately references board game Clue"
}`;
  }

  /**
   * Call Gemini CLI to rewrite a question with timeout
   */
  async callGemini(prompt: string, timeoutMs: number = 60000): Promise<GeminiResponse> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Gemini CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        // Use stdin to pass the prompt to avoid command line length limits
        const proc = Bun.spawn(['gemini', '-m', 'gemini-2.5-pro', '-o', 'text'], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        });

        // Write prompt to stdin and close it (Bun API)
        proc.stdin.write(prompt);
        proc.stdin.end();

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        const exitCode = await proc.exited;

        clearTimeout(timeout);

        if (exitCode !== 0) {
          console.error(`\n❌ Gemini CLI failed with exit code ${exitCode}`);
          if (stderr) console.error(`stderr: ${stderr}`);
          if (stdout) console.error(`stdout: ${stdout}`);
          reject(new Error(`Gemini CLI failed: ${stderr || stdout || 'Unknown error'}`));
          return;
        }

        // Clean up the response (remove markdown code blocks if present)
        let cleaned = stdout.trim();
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned.slice(7);
        } else if (cleaned.startsWith('```')) {
          cleaned = cleaned.slice(3);
        }
        if (cleaned.endsWith('```')) {
          cleaned = cleaned.slice(0, -3);
        }
        cleaned = cleaned.trim();

        const parsed = JSON.parse(cleaned);
        resolve(parsed);
      } catch (error) {
        clearTimeout(timeout);
        console.error(`\n❌ Error calling Gemini: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Update metadata field with timestamp
   */
  updateMetadata(existingMetadata: string): string {
    const timestamp = new Date().toISOString();

    try {
      if (!existingMetadata || existingMetadata.trim() === '') {
        // Create new metadata object
        return JSON.stringify({ QUESTION_REWRITE: timestamp });
      }

      // Parse existing metadata and add field
      const metadata = JSON.parse(existingMetadata);
      metadata.QUESTION_REWRITE = timestamp;
      return JSON.stringify(metadata);
    } catch {
      // If existing metadata is not valid JSON, create new object
      return JSON.stringify({
        QUESTION_REWRITE: timestamp,
        _original_metadata: existingMetadata
      });
    }
  }

  /**
   * Update a question in the database
   */
  updateQuestion(id: string, response: GeminiResponse, originalMetadata: string): void {
    const metadata = this.updateMetadata(originalMetadata);

    const stmt = this.db.prepare(`
      UPDATE questions
      SET question = ?, a = ?, b = ?, c = ?, d = ?, metadata = ?
      WHERE id = ?
    `);

    stmt.run(response.question, response.a, response.b, response.c, response.d, metadata, id);
  }

  /**
   * Display progress with stats
   */
  showProgress(): void {
    const percentage = ((this.processed / this.queueSize) * 100).toFixed(1);
    const remaining = this.queueSize - this.processed;
    const eta = this.getEstimatedTimeRemaining();

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📊 Progress: ${this.processed}/${this.queueSize} (${percentage}%) | Remaining: ${remaining} questions`);
    console.log(`   ⏱️  Estimated time remaining: ${eta}`);
    console.log(`   ✅ Updated: ${this.updated}`);
    console.log(`   ⏭️  Skipped (valid): ${this.skipped}`);
    console.log(`${'─'.repeat(80)}`);
  }

  /**
   * Process the queue sequentially
   */
  async processQueue(questionIds: string[]): Promise<void> {
    console.log('🚀 Starting question cleanup process...\n');
    this.startTime = Date.now();

    for (let i = 0; i < questionIds.length; i++) {
      const id = questionIds[i];
      this.processed++;

      const question = this.getQuestion(id);
      if (!question) {
        console.log(`⚠️  Question ${id} not found, skipping...`);
        continue;
      }

      const percentage = ((this.processed / this.queueSize) * 100).toFixed(1);
      const remaining = this.queueSize - this.processed;

      console.log(`\n${'='.repeat(80)}`);
      console.log(`Processing ${this.processed}/${this.queueSize} (${percentage}%) | ${remaining} remaining`);
      console.log(`ID: ${id}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Original Question: ${question.question}`);

      try {
        // Build prompt and call Gemini
        const prompt = this.buildPrompt(question);
        const response = await this.callGemini(prompt);

        if (response.leave_unchanged) {
          console.log(`\n✅ Keeping question unchanged: ${response.reason || 'No issues found'}`);
          this.skipped++;
        } else {
          // Log the change before updating
          this.logChange(question, response);

          // Update the question
          this.updateQuestion(id, response, question.metadata);

          console.log(`\n✏️  UPDATED QUESTION:`);
          console.log(`Q: ${response.question}`);
          console.log(`A: ${response.a} ✓`);
          console.log(`B: ${response.b}`);
          console.log(`C: ${response.c}`);
          console.log(`D: ${response.d}`);

          this.updated++;
        }

        // Show progress stats
        const eta = this.getEstimatedTimeRemaining();
        console.log(`\n⏱️  ETA: ${eta} | Updated: ${this.updated} | Skipped: ${this.skipped}`);

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`\n❌ Error processing question ${id}:`, error);
        console.log(`Continuing with next question...\n`);
      }
    }

    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎉 Cleanup Complete!');
    console.log(`${'='.repeat(80)}`);
    this.showProgress();
    console.log('');
  }

  close(): void {
    this.db.close();
  }
}

// Main execution
async function main() {
  const dbPath = process.argv[2] || './jeopardy.db';

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Jeopardy Question Cleanup Script                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nDatabase: ${dbPath}`);
  console.log(`Log file: cleanup-questions.log\n`);

  const cleanup = new QuestionCleanup(dbPath);

  try {
    // Build the queue
    const questionIds = cleanup.buildQueue();

    if (questionIds.length === 0) {
      console.log('✨ No questions need cleaning. Database is clean!\n');
      return;
    }

    // Process the queue
    await cleanup.processQueue(questionIds);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    cleanup.close();
  }
}

main();
