#!/usr/bin/env bun

/**
 * Trivia Question Validation Tool
 * Validates questions in SQLite database using Gemini CLI
 * Uses your Gemini Pro subscription via CLI
 */

import { Database } from "bun:sqlite";
import { spawn } from "child_process";

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
  external_id: string;
  imported_at: string;
  level: string;
}

// Database functions
function openDatabase(): Database {
  try {
    const db = new Database("questions.db");
    return db;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("ENOENT") || error.message.includes("no such file")) {
        throw new Error("Database file 'questions.db' not found. Please ensure the file exists in the current directory.");
      }
      if (error.message.includes("EACCES") || error.message.includes("permission")) {
        throw new Error("Permission denied accessing 'questions.db'. Please check file permissions.");
      }
      throw new Error(`Failed to open database: ${error.message}`);
    }
    throw new Error("Failed to open database: Unknown error");
  }
}

function getUnvalidatedCount(db: Database): number {
  try {
    const result = db.query("SELECT COUNT(*) as count FROM questions WHERE metadata = ''").get() as { count: number };
    return result.count;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to query unvalidated count: ${error.message}`);
    }
    throw new Error("Failed to query unvalidated count: Unknown error");
  }
}

function claimNextBatch(db: Database, batchSize: number, workerId: string): Question[] {
  try {
    // Atomically claim a batch by marking as PROCESSING
    db.exec("BEGIN IMMEDIATE TRANSACTION");

    const query = db.query("SELECT * FROM questions WHERE metadata = '' LIMIT ?");
    const batch = query.all(batchSize) as Question[];

    if (batch.length > 0) {
      const ids = batch.map(q => `'${q.id}'`).join(',');
      db.exec(`UPDATE questions SET metadata = 'PROCESSING:${workerId}' WHERE id IN (${ids})`);
    }

    db.exec("COMMIT");
    return batch;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}

    if (error instanceof Error) {
      throw new Error(`Failed to claim next batch: ${error.message}`);
    }
    throw new Error("Failed to claim next batch: Unknown error");
  }
}

function updateMetadata(db: Database, id: string, metadata: string): void {
  try {
    const query = db.query("UPDATE questions SET metadata = ? WHERE id = ?");
    query.run(metadata, id);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to update metadata for question ${id}: ${error.message}`);
    }
    throw new Error(`Failed to update metadata for question ${id}: Unknown error`);
  }
}

function buildBatchValidationPrompt(questions: Question[]): string {
  const questionsText = questions.map((q, idx) =>
    `QUESTION ${idx + 1} (ID: ${q.id}):
Question: ${q.question}
Correct Answer: ${q.answer_a}
Wrong Answers: ${q.answer_b}, ${q.answer_c}, ${q.answer_d}
Category: ${q.category} - ${q.subcategory}
Difficulty: ${q.difficulty}`
  ).join('\n\n');

  return `You are validating trivia questions. For each question below, provide ONLY validation tags on a single line.

Check for these issues:
- INCORRECT: Is answer_a actually correct?
- AMBIGUOUS: Is the question too ambiguous?
- INCOMPLETE: Is the question incomplete?
- UNCLEAR: Is the question unclear to average American adults?
- OBVIOUS: Is the answer spelled out in the question?
- OVERDETAILED-ANSWER: Does answer_a have unnecessary detail making it stand out?

Respond with EXACTLY ${questions.length} lines, one per question, in order:
- "OK" if no issues found
- Space-separated tags if issues found (e.g., "AMBIGUOUS UNCLEAR")

${questionsText}

RESPONSES (one per line, in order):`;
}

async function validateBatch(questions: Question[]): Promise<string[]> {
  const prompt = buildBatchValidationPrompt(questions);

  return new Promise((resolve, reject) => {
    const gemini = spawn('gemini', ['-p', prompt]);

    let stdout = '';
    let stderr = '';

    gemini.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gemini.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gemini.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Gemini CLI failed: ${stderr || stdout}`));
        return;
      }

      const response = stdout.trim();
      if (!response) {
        reject(new Error("Empty response from Gemini CLI"));
        return;
      }

      // Parse response lines
      const lines = response.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (lines.length !== questions.length) {
        console.warn(`Warning: Expected ${questions.length} responses, got ${lines.length}`);
        console.warn(`Response: ${response}`);
        // Pad with OK if needed
        while (lines.length < questions.length) {
          lines.push('OK');
        }
      }

      resolve(lines.slice(0, questions.length));
    });

    gemini.on('error', (error) => {
      reject(new Error(`Failed to run Gemini CLI: ${error.message}\nMake sure 'gemini' command is available.`));
    });
  });
}

// Main execution
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const workerIdArg = args.find(arg => arg.startsWith('--worker-id='));
  const reclaimArg = args.includes('--reclaim');
  const workerId = workerIdArg ? workerIdArg.split('=')[1] : '1';

  console.log(`Trivia Question Validator (Using Gemini CLI) - Worker ${workerId}\n`);

  try {
    // Open database
    console.log("Opening database...");
    const db = openDatabase();

    // Reclaim stuck PROCESSING questions if requested
    if (reclaimArg) {
      console.log("Reclaiming stuck PROCESSING questions...");
      const reclaimed = db.exec("UPDATE questions SET metadata = '' WHERE metadata LIKE 'PROCESSING:%'");
      console.log(`Reclaimed questions, ready to process\n`);
    }

    // Test Gemini CLI is available
    console.log("Testing Gemini CLI...");
    try {
      await validateBatch([{
        id: 'test',
        question: 'Test question',
        answer_a: 'Test',
        answer_b: 'Test',
        answer_c: 'Test',
        answer_d: 'Test',
        category: 'Test',
        subcategory: 'Test',
        difficulty: 'easy',
        metadata: '',
        external_id: '',
        imported_at: '',
        level: ''
      }]);
      console.log("Gemini CLI is working!\n");
    } catch (error) {
      db.close();
      throw new Error("Gemini CLI not found or not working. Please install it first.");
    }

    // Get total count
    const totalCount = getUnvalidatedCount(db);
    if (totalCount === 0) {
      console.log("No questions to validate. All done!");
      db.close();
      return;
    }

    console.log(`Found ${totalCount} questions to validate\n`);

    // Process batches (25 questions at a time for better throughput)
    let processed = 0;
    const batchSize = 25;

    while (true) {
      const batch = claimNextBatch(db, batchSize, workerId);
      if (batch.length === 0) break;

      try {
        const startTime = Date.now();
        const results = await validateBatch(batch);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Update database with results
        for (let i = 0; i < batch.length; i++) {
          updateMetadata(db, batch[i].id, results[i]);
          processed++;
        }

        const rate = (batch.length / (Date.now() - startTime) * 1000).toFixed(1);
        console.log(`[Worker ${workerId}] Processed ${processed}/${totalCount} questions (batch: ${elapsed}s, ${rate} q/s)`);

      } catch (error) {
        console.error(`\n[Worker ${workerId}] Error validating batch:`);
        console.error(error instanceof Error ? error.message : String(error));
        db.close();
        process.exit(1);
      }
    }

    console.log(`\n[Worker ${workerId}] Complete! Validated ${processed} questions`);
    db.close();

  } catch (error) {
    console.error("\nFatal error:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run
main();
