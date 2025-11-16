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

function getNextBatch(db: Database, batchSize: number): Question[] {
  try {
    const query = db.query("SELECT * FROM questions WHERE metadata = '' LIMIT ?");
    return query.all(batchSize) as Question[];
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to retrieve next batch of questions: ${error.message}`);
    }
    throw new Error("Failed to retrieve next batch of questions: Unknown error");
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

async function validateQuestion(q: Question): Promise<string> {
  const prompt = buildValidationPrompt(q);

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

      resolve(response);
    });

    gemini.on('error', (error) => {
      reject(new Error(`Failed to run Gemini CLI: ${error.message}\nMake sure 'gemini' command is available.`));
    });
  });
}

// Main execution
async function main() {
  console.log("Trivia Question Validator (Using Gemini CLI)\n");

  try {
    // Test Gemini CLI is available
    console.log("Testing Gemini CLI...");
    try {
      await validateQuestion({
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
      });
      console.log("Gemini CLI is working!\n");
    } catch (error) {
      throw new Error("Gemini CLI not found or not working. Please install it first.");
    }

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
          const result = await validateQuestion(question);
          updateMetadata(db, question.id, result);
          processed++;

          console.log(`Processed ${processed}/${totalCount} questions`);

        } catch (error) {
          console.error(`\nError validating question ${question.id}:`);
          console.error(error instanceof Error ? error.message : String(error));
          db.close();
          process.exit(1);
        }
      }
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
