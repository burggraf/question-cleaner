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
