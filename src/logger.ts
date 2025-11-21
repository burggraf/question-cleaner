import { appendFileSync } from 'fs';

export class Logger {
  constructor(
    private processingLog = 'processing.log',
    private failedLog = 'failed-batches.log'
  ) {}

  logBatch(batchNumber: number, questionIds: string[]): void {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] Batch ${batchNumber}: Processing ${questionIds.length} questions (${questionIds[0]} - ${questionIds[questionIds.length - 1]})\n`;
    appendFileSync(this.processingLog, message);
  }

  logError(batchNumber: number, questionIds: string[], error: string, rawResponse?: string): void {
    const timestamp = new Date().toISOString();
    let message = `[${timestamp}] Batch ${batchNumber} FAILED\n`;
    message += `Question IDs: ${questionIds.join(', ')}\n`;
    message += `Error: ${error}\n`;
    if (rawResponse) {
      message += `Raw response: ${rawResponse}\n`;
    }
    message += '---\n';

    appendFileSync(this.failedLog, message);
    appendFileSync(this.processingLog, message);
  }

  logValidationError(batchNumber: number, questionIds: string[], reason: string): void {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] Batch ${batchNumber} VALIDATION FAILED: ${reason}\n`;
    appendFileSync(this.failedLog, message);
    appendFileSync(this.processingLog, message);
  }

  logInfo(message: string): void {
    const timestamp = new Date().toISOString();
    appendFileSync(this.processingLog, `[${timestamp}] ${message}\n`);
  }
}
