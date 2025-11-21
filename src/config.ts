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
