import { Config } from './types';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export function parseConfig(): Config {
  let apiKeys: string[] = [];

  // Check for .keys file first
  const keysFilePath = resolve('.keys');
  if (existsSync(keysFilePath)) {
    console.log('Loading API keys from .keys file...');
    const fileContent = readFileSync(keysFilePath, 'utf-8');
    apiKeys = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')); // Remove blank lines and comments

    if (apiKeys.length === 0) {
      throw new Error('.keys file exists but contains no valid API keys');
    }
    console.log(`Loaded ${apiKeys.length} API key(s) from .keys file\n`);
  } else {
    // Fall back to environment variable
    const apiKeyEnv = process.env.GEMINI_API_KEY;
    if (!apiKeyEnv) {
      throw new Error('GEMINI_API_KEY environment variable is required (or create a .keys file with one key per line)');
    }

    // Parse comma-separated API keys
    apiKeys = apiKeyEnv.split(',').map(key => key.trim()).filter(key => key.length > 0);
    if (apiKeys.length === 0) {
      throw new Error('GEMINI_API_KEY must contain at least one valid API key');
    }
  }

  const args = process.argv.slice(2);
  const config: Config = {
    dbPath: './jeopardy.db',
    batchSize: 100,
    apiKeys,
    delayMs: 3000,
    workers: 5,
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
    } else if (args[i] === '--workers' && args[i + 1]) {
      config.workers = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--delay' && args[i + 1]) {
      config.delayMs = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Validate parsed configuration
  if (isNaN(config.batchSize) || config.batchSize <= 0) {
    throw new Error('--batch-size must be a positive number');
  }
  if (config.limit !== undefined && (isNaN(config.limit) || config.limit <= 0)) {
    throw new Error('--limit must be a positive number');
  }
  if (!config.dbPath || config.dbPath.trim().length === 0) {
    throw new Error('--db path cannot be empty');
  }
  if (isNaN(config.workers) || config.workers <= 0) {
    throw new Error('--workers must be a positive number');
  }
  if (isNaN(config.delayMs) || config.delayMs < 0) {
    throw new Error('--delay must be a non-negative number');
  }

  return config;
}
