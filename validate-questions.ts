#!/usr/bin/env bun

/**
 * Trivia Question Validation Tool
 * Validates questions in SQLite database using Gemini Pro 2.5
 */

console.log("Trivia Question Validator - Starting...");

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

function deleteTokenStorage(): void {
  try {
    const fs = require("fs");
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    // File doesn't exist, ignore
  }
}

// OAuth2 helper functions
function startLocalServer(): Promise<{ server: any; codePromise: Promise<string> }> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  let server;
  try {
    server = Bun.serve({
      port: 8080,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/oauth2callback") {
          const error = url.searchParams.get("error");
          if (error) {
            const errorDescription = url.searchParams.get("error_description") || "No description provided";
            rejectCode(new Error(`OAuth error: ${error} - ${errorDescription}`));
            return new Response(`Authentication failed: ${error}`, { status: 400 });
          }

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
  } catch (error) {
    throw new Error(`Failed to start local server on port 8080. Is the port already in use? ${error}`);
  }

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

  const data = await response.json();

  // Validate token response structure
  if (!data.access_token || !data.refresh_token || !data.expires_in) {
    throw new Error("Invalid token response: missing required fields (access_token, refresh_token, or expires_in)");
  }

  return data;
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
    const errorBody = await response.text();
    throw new Error(`Refresh token expired or invalid (status ${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  // Validate token response structure
  if (!data.access_token) {
    throw new Error("Invalid refresh token response: missing access_token");
  }

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

  // Wait for callback and ensure server is stopped even if token exchange fails
  let code: string;
  try {
    code = await codePromise;
  } finally {
    server.stop();
  }

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
