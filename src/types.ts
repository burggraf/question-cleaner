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
