import type { BatchStats } from './types';

interface WorkerStats {
  completed: number;
  failed: number;
  questionsProcessed: number;
}

export class ProgressTracker {
  private stats: BatchStats;
  private workerStats: Map<number, WorkerStats>;
  private lastDisplayTime: number = 0;
  private displayThrottleMs: number = 1000; // Only update display once per second

  constructor(
    totalQuestions: number,
    unprocessedCount: number,
    batchSize: number,
    workerCount: number
  ) {
    this.stats = {
      batchNumber: 0,
      totalBatches: Math.ceil(unprocessedCount / batchSize),
      questionsProcessed: totalQuestions - unprocessedCount,
      totalQuestions,
      failedBatches: 0,
      startTime: Date.now(),
    };

    // Initialize per-worker stats
    this.workerStats = new Map();
    for (let i = 1; i <= workerCount; i++) {
      this.workerStats.set(i, { completed: 0, failed: 0, questionsProcessed: 0 });
    }
  }

  startBatch(workerId: number): void {
    this.stats.batchNumber++;
  }

  completeBatch(workerId: number, questionsInBatch: number): void {
    this.stats.questionsProcessed += questionsInBatch;
    const workerStat = this.workerStats.get(workerId)!;
    workerStat.completed++;
    workerStat.questionsProcessed += questionsInBatch;
  }

  failBatch(workerId: number): void {
    this.stats.failedBatches++;
    const workerStat = this.workerStats.get(workerId)!;
    workerStat.failed++;
  }

  getProgress(force: boolean = false): string | null {
    // Throttle display updates to avoid spam
    const now = Date.now();
    if (!force && now - this.lastDisplayTime < this.displayThrottleMs) {
      return null;
    }
    this.lastDisplayTime = now;

    const percent = this.stats.totalBatches === 0 ? 100 :
      Math.round((this.stats.batchNumber / this.stats.totalBatches) * 100);
    const elapsed = now - this.stats.startTime;
    const avgTimePerBatch = this.stats.batchNumber === 0 ? 0 :
      elapsed / this.stats.batchNumber;
    const remainingBatches = this.stats.totalBatches - this.stats.batchNumber;
    const etaMs = avgTimePerBatch * remainingBatches;
    const eta = this.formatTime(etaMs);

    let output = `Progress: ${this.stats.questionsProcessed.toLocaleString()}/${this.stats.totalQuestions.toLocaleString()} (${percent}%) | `;
    output += `Batches: ${this.stats.batchNumber}/${this.stats.totalBatches} | `;
    output += `Failed: ${this.stats.failedBatches} | `;
    output += `ETA: ${eta}\n`;

    // Add per-worker breakdown
    this.workerStats.forEach((stats, id) => {
      output += `  Worker ${id}: ${stats.questionsProcessed} questions (${stats.completed} batches, ${stats.failed} failed)\n`;
    });

    return output;
  }

  getBatchNumber(): number {
    return this.stats.batchNumber;
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
    let output = `\nProcessing complete!\n`;
    output += `Processed: ${this.stats.questionsProcessed.toLocaleString()} questions\n`;
    output += `Failed batches: ${this.stats.failedBatches}\n`;
    output += `Time: ${elapsed}\n\n`;
    output += `Per-worker stats:\n`;
    this.workerStats.forEach((stats, id) => {
      output += `  Worker ${id}: ${stats.questionsProcessed} questions (${stats.completed} batches, ${stats.failed} failed)\n`;
    });
    return output;
  }
}
