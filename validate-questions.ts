#!/usr/bin/env bun

/**
 * Trivia Question Validation Tool
 * Validates questions in SQLite database using Gemini Pro subscription via web interface
 * Authentication: Browser session (no API key needed)
 */

import { Database } from "bun:sqlite";
import puppeteer from "puppeteer";

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

async function validateQuestion(page: any, q: Question): Promise<string> {
  const prompt = buildValidationPrompt(q);

  try {
    // Find the textarea and type the prompt
    await page.waitForSelector('div[contenteditable="true"]', { timeout: 5000 });
    await page.click('div[contenteditable="true"]');
    await page.keyboard.type(prompt);

    // Submit (Enter key)
    await page.keyboard.press('Enter');

    // Wait for response to appear
    await page.waitForFunction(() => {
      const responses = document.querySelectorAll('[data-test-id="model-response"]');
      return responses.length > 0;
    }, { timeout: 30000 });

    // Wait a bit for response to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract the response text
    const responseText = await page.evaluate(() => {
      const responses = document.querySelectorAll('[data-test-id="model-response"]');
      if (responses.length > 0) {
        const lastResponse = responses[responses.length - 1];
        return lastResponse.textContent || '';
      }
      return '';
    });

    if (!responseText) {
      throw new Error("No response received from Gemini");
    }

    return responseText.trim();

  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Gemini validation failed: ${error.message}`);
    }
    throw new Error("Gemini validation failed: Unknown error");
  }
}

// Main execution
async function main() {
  console.log("Trivia Question Validator (Using Gemini Pro Subscription)\n");

  let browser;
  let page;

  try {
    // Launch browser
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: false, // Keep visible so you can see it working
      userDataDir: './gemini-session', // Persist login session
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to Gemini
    console.log("Navigating to Gemini...");
    await page.goto('https://gemini.google.com', { waitUntil: 'networkidle2' });

    // Check if already logged in or wait for manual login
    console.log("\nPlease log in to Gemini if needed.");
    console.log("Once you see the Gemini chat interface, the tool will start.\n");

    // Wait for the chat interface to be ready
    await page.waitForSelector('div[contenteditable="true"]', { timeout: 120000 });
    console.log("Gemini interface ready!\n");

    // Open database
    console.log("Opening database...");
    const db = openDatabase();

    // Get total count
    const totalCount = getUnvalidatedCount(db);
    if (totalCount === 0) {
      console.log("No questions to validate. All done!");
      db.close();
      await browser.close();
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
          const result = await validateQuestion(page, question);
          updateMetadata(db, question.id, result);
          processed++;

          console.log(`Processed ${processed}/${totalCount} questions`);

          // Wait between questions to avoid overwhelming the interface
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
          console.error(`\nError validating question ${question.id}:`);
          console.error(error instanceof Error ? error.message : String(error));
          db.close();
          await browser.close();
          process.exit(1);
        }
      }
    }

    console.log(`\nComplete! Validated ${totalCount} questions`);
    db.close();
    await browser.close();

  } catch (error) {
    console.error("\nFatal error:");
    console.error(error instanceof Error ? error.message : String(error));
    if (browser) await browser.close();
    process.exit(1);
  }
}

// Run
main();
