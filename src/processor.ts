import { Database } from 'bun:sqlite';
import { DatabaseClient } from './database';
import { GeminiClient } from './gemini';
import { Validator } from './validator';
import { ProgressTracker } from './progress';
import { Logger } from './logger';
import type { Config } from './types';

export class QuestionProcessor {
  private db: DatabaseClient;
  private gemini: GeminiClient;
  private validator: Validator;
  private logger: Logger;

  constructor(private config: Config) {
    const database = new Database(config.dbPath);
    this.db = new DatabaseClient(database);
    this.gemini = new GeminiClient(config.apiKey);
    this.validator = new Validator();
    this.logger = new Logger();
  }

  async run(): Promise<void> {
    console.log('Initializing database...');
    this.db.createIndexes();

    const totalQuestions = this.db.getTotalQuestions();
    const unprocessedCount = this.db.getUnprocessedCount();

    console.log(`Total questions: ${totalQuestions.toLocaleString()}`);
    console.log(`Unprocessed questions: ${unprocessedCount.toLocaleString()}`);

    if (unprocessedCount === 0) {
      console.log('No questions to process!');
      return;
    }

    const batchesToProcess = this.config.limit || Math.ceil(unprocessedCount / this.config.batchSize);
    console.log(`Will process ${batchesToProcess} batches\n`);

    const progress = new ProgressTracker(totalQuestions, unprocessedCount, this.config.batchSize);

    for (let i = 0; i < batchesToProcess; i++) {
      progress.startBatch();

      const batch = this.db.getUnprocessedBatch(this.config.batchSize);
      if (batch.length === 0) {
        console.log('No more unprocessed questions');
        break;
      }

      const questionIds = batch.map(q => q.id);
      this.logger.logBatch(progress['stats'].batchNumber, questionIds);

      try {
        // Process with Gemini
        const processed = await this.gemini.processBatch(batch);

        // Validate response
        if (processed.length !== batch.length) {
          throw new Error(`Expected ${batch.length} questions, got ${processed.length}`);
        }

        const validationResult = this.validator.validateBatch(processed);
        if (!validationResult.valid) {
          this.logger.logValidationError(
            progress['stats'].batchNumber,
            questionIds,
            validationResult.reason!
          );
          progress.failBatch();
          console.log(`${progress.getProgress()} - VALIDATION FAILED`);
        } else {
          // Update database
          this.db.updateBatch(processed);
          progress.completeBatch(batch.length);
          console.log(progress.getProgress());
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check for fatal errors
        if (
          errorMessage.includes('429') ||
          errorMessage.includes('5') && errorMessage.includes('status') ||
          errorMessage.includes('network') ||
          errorMessage.includes('ECONNREFUSED')
        ) {
          console.error(`\n\nFATAL ERROR: ${errorMessage}`);
          console.error('Stopping processing due to infrastructure issue.\n');
          this.logger.logError(progress['stats'].batchNumber, questionIds, errorMessage);
          process.exit(1);
        }

        // Non-fatal error: log and continue
        this.logger.logError(
          progress['stats'].batchNumber,
          questionIds,
          errorMessage
        );
        progress.failBatch();
        console.log(`${progress.getProgress()} - ERROR: ${errorMessage}`);
      }

      // Delay between batches
      if (i < batchesToProcess - 1) {
        await new Promise(resolve => setTimeout(resolve, this.config.delayMs));
      }
    }

    console.log(progress.getSummary());
    this.logger.logInfo('Processing complete');
  }
}
