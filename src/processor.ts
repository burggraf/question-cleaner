import { Database } from 'bun:sqlite';
import { DatabaseClient } from './database';
import { GeminiClient } from './gemini';
import { Validator } from './validator';
import { ProgressTracker } from './progress';
import { Logger } from './logger';
import { migrateDatabase, resetStuckBatches } from './migrate';
import type { Config } from './types';

export class QuestionProcessor {
  private db: DatabaseClient;
  private database: Database;
  private gemini: GeminiClient;
  private validator: Validator;
  private logger: Logger;
  private progress: ProgressTracker | null = null;
  private stopSignal: boolean = false;
  private consecutive503Errors: number = 0;
  private readonly MAX_503_RETRIES = 10;
  private readonly RETRY_DELAY_MS = 30000; // 30 seconds

  constructor(private config: Config) {
    this.database = new Database(config.dbPath);
    this.db = new DatabaseClient(this.database);
    this.gemini = new GeminiClient(config.apiKey);
    this.validator = new Validator();
    this.logger = new Logger();
  }

  async run(): Promise<void> {
    console.log('Initializing database...');

    // Run migrations
    migrateDatabase(this.database);

    // Reset stuck batches from previous runs
    resetStuckBatches(this.database);

    // Create indexes
    this.db.createIndexes();

    const totalQuestions = this.db.getTotalQuestions();
    const unprocessedCount = this.db.getUnprocessedCount();

    console.log(`Total questions: ${totalQuestions.toLocaleString()}`);
    console.log(`Unprocessed questions: ${unprocessedCount.toLocaleString()}`);
    console.log(`Workers: ${this.config.workers}`);
    console.log(`Batch size: ${this.config.batchSize}`);
    console.log(`Delay between batches: ${this.config.delayMs}ms\n`);

    if (unprocessedCount === 0) {
      console.log('No questions to process!');
      return;
    }

    this.progress = new ProgressTracker(
      totalQuestions,
      unprocessedCount,
      this.config.batchSize,
      this.config.workers
    );

    // Set up graceful shutdown handler
    this.setupShutdownHandler();

    // Launch workers in parallel
    const workers = Array.from({ length: this.config.workers }, (_, i) =>
      this.worker(i + 1)
    );

    await Promise.all(workers);

    console.log(this.progress.getSummary());
    this.logger.logInfo('Processing complete');
  }

  private async worker(workerId: number): Promise<void> {
    let batchesProcessed = 0;
    const maxBatches = this.config.limit || Infinity;

    while (!this.stopSignal && batchesProcessed < maxBatches) {
      // Atomically claim a batch
      const batch = this.db.claimBatch(this.config.batchSize);

      if (batch.length === 0) {
        // No more work available
        break;
      }

      batchesProcessed++;
      this.progress!.startBatch(workerId);

      const questionIds = batch.map(q => q.id);
      this.logger.logBatch(this.progress!.getBatchNumber(), questionIds);

      try {
        // Process with Gemini
        const processed = await this.gemini.processBatch(batch);

        // Validate response length
        if (processed.length !== batch.length) {
          throw new Error(`Expected ${batch.length} questions, got ${processed.length}`);
        }

        // Sanitize any invalid JSON metadata
        const sanitized = this.validator.sanitizeBatch(processed);

        // Validate sanitized data
        const validationResult = this.validator.validateBatch(sanitized);
        if (!validationResult.valid) {
          this.logger.logValidationError(
            this.progress!.getBatchNumber(),
            questionIds,
            validationResult.reason!
          );
          this.db.markBatchFailed(questionIds);
          this.progress!.failBatch(workerId);
          this.displayProgress();
        } else {
          // Update database with completed status
          this.db.updateBatch(sanitized, 'completed');
          this.progress!.completeBatch(workerId, batch.length);
          this.displayProgress();

          // Reset 503 error counter on successful processing
          this.consecutive503Errors = 0;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check for 503 Service Unavailable (model overloaded)
        if (errorMessage.includes('503')) {
          this.consecutive503Errors++;
          console.log(`\n\nWarning (Worker ${workerId}): Service overloaded (503). Retry ${this.consecutive503Errors}/${this.MAX_503_RETRIES}`);

          if (this.consecutive503Errors >= this.MAX_503_RETRIES) {
            console.error(`\n\nFATAL ERROR: Received 503 errors ${this.MAX_503_RETRIES} times in a row. Stopping.\n`);
            this.logger.logError(this.progress!.getBatchNumber(), questionIds, errorMessage);
            this.stopSignal = true;
            process.exit(1);
          }

          // Log the error and mark batch as failed (will be retried)
          this.logger.logError(this.progress!.getBatchNumber(), questionIds, errorMessage);
          this.db.markBatchFailed(questionIds);
          this.progress!.failBatch(workerId);
          this.displayProgress();

          // Pause for 30 seconds before continuing
          console.log(`Pausing for 30 seconds before retrying...\n`);
          await this.sleep(this.RETRY_DELAY_MS);
          continue; // Skip the normal delay and continue to next batch
        }

        // Check for other fatal errors
        if (this.isFatalError(errorMessage)) {
          console.error(`\n\nFATAL ERROR (Worker ${workerId}): ${errorMessage}`);
          console.error('Stopping all workers due to infrastructure issue.\n');
          this.logger.logError(this.progress!.getBatchNumber(), questionIds, errorMessage);
          this.stopSignal = true;
          process.exit(1);
        }

        // Non-fatal error: log and continue
        this.logger.logError(
          this.progress!.getBatchNumber(),
          questionIds,
          errorMessage
        );
        this.db.markBatchFailed(questionIds);
        this.progress!.failBatch(workerId);
        this.displayProgress();
      }

      // Delay between batches
      await this.sleep(this.config.delayMs);
    }
  }

  private isFatalError(errorMessage: string): boolean {
    // 503 errors are handled separately with retry logic
    if (errorMessage.includes('503')) {
      return false;
    }

    return (
      errorMessage.includes('429') ||
      (errorMessage.includes('status') && /5\d{2}/.test(errorMessage)) ||
      errorMessage.includes('network') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ENOTFOUND')
    );
  }

  private displayProgress(): void {
    if (!this.progress) return;
    const output = this.progress.getProgress();
    if (output) {
      // Clear previous lines and display new progress
      process.stdout.write('\x1b[2K\r'); // Clear line
      process.stdout.write(output);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private setupShutdownHandler(): void {
    process.on('SIGINT', () => {
      console.log('\n\nReceived SIGINT, gracefully shutting down...');
      console.log('Waiting for workers to finish current batches...\n');
      this.stopSignal = true;
    });
  }
}
