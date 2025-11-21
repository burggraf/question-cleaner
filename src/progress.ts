import type { BatchStats } from './types';

export class ProgressTracker {
  private stats: BatchStats;

  constructor(
    totalQuestions: number,
    unprocessedCount: number,
    batchSize: number
  ) {
    this.stats = {
      batchNumber: 0,
      totalBatches: Math.ceil(unprocessedCount / batchSize),
      questionsProcessed: totalQuestions - unprocessedCount,
      totalQuestions,
      failedBatches: 0,
      startTime: Date.now(),
    };
  }

  startBatch(): void {
    this.stats.batchNumber++;
  }

  completeBatch(questionsInBatch: number): void {
    this.stats.questionsProcessed += questionsInBatch;
  }

  failBatch(): void {
    this.stats.failedBatches++;
  }

  getProgress(): string {
    const percent = this.stats.totalBatches === 0 ? 100 :
      Math.round((this.stats.batchNumber / this.stats.totalBatches) * 100);
    const elapsed = Date.now() - this.stats.startTime;
    const avgTimePerBatch = this.stats.batchNumber === 0 ? 0 :
      elapsed / this.stats.batchNumber;
    const remainingBatches = this.stats.totalBatches - this.stats.batchNumber;
    const etaMs = avgTimePerBatch * remainingBatches;
    const eta = this.formatTime(etaMs);

    return `Batch ${this.stats.batchNumber}/${this.stats.totalBatches} (${percent}%) | ` +
           `${this.stats.questionsProcessed.toLocaleString()}/${this.stats.totalQuestions.toLocaleString()} questions | ` +
           `${this.stats.failedBatches} failed | ` +
           `ETA: ${eta}`;
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getSummary(): string {
    const elapsed = this.formatTime(Date.now() - this.stats.startTime);
    return `\nProcessing complete!\n` +
           `Processed: ${this.stats.questionsProcessed.toLocaleString()} questions\n` +
           `Failed batches: ${this.stats.failedBatches}\n` +
           `Time: ${elapsed}`;
  }
}
