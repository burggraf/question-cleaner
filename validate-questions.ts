#!/usr/bin/env bun

/**
 * Trivia Question Validation Tool
 * Validates questions in SQLite database using Gemini 2.0 Flash
 * Authentication: Google Cloud CLI (gcloud)
 */

import { Database } from "bun:sqlite";
import { GoogleAuth } from "google-auth-library";

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

// Authentication function using gcloud credentials
async function authenticate(): Promise<string> {
  console.log("Authenticating with Google Cloud credentials...");

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/generative-language']
    });

    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to obtain access token from gcloud credentials");
    }

    console.log("Authentication successful!\n");
    return accessToken.token;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Could not load the default credentials")) {
        throw new Error(
          "Google Cloud credentials not found.\n" +
          "Please run: gcloud auth application-default login --scopes=https://www.googleapis.com/auth/generative-language,https://www.googleapis.com/auth/cloud-platform"
        );
      }
      throw new Error(`Authentication failed: ${error.message}`);
    }
    throw new Error("Authentication failed: Unknown error");
  }
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
    // Parameters: metadata (value to set), id (WHERE condition)
    const query = db.query("UPDATE questions SET metadata = ? WHERE id = ?");
    query.run(metadata, id);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to update metadata for question ${id}: ${error.message}`);
    }
    throw new Error(`Failed to update metadata for question ${id}: Unknown error`);
  }
}

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

  // Validate response structure
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("Gemini API returned no candidates (possible safety filter block)");
  }

  const candidate = data.candidates[0];

  // Check for safety filter blocks
  if (candidate.finishReason === "SAFETY") {
    throw new Error("Content blocked by Gemini safety filters");
  }

  // Check for recitation concerns
  if (candidate.finishReason === "RECITATION") {
    throw new Error("Content blocked due to recitation concerns");
  }

  // Extract text from response
  const text = candidate.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Invalid response format from Gemini (finishReason: ${candidate.finishReason})`);
  }

  return text.trim();
}

// Main execution
async function main() {
  console.log("Trivia Question Validator\n");

  try {
    // Authenticate with gcloud
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

          // Rate limiting: 100ms delay between API requests
          await new Promise(resolve => setTimeout(resolve, 100));
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
