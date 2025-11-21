import { Database } from 'bun:sqlite';
import type { Question, ProcessedQuestion } from './types';

export class DatabaseClient {
  constructor(private db: Database) {}

  createIndexes(): void {
    this.db.run('CREATE INDEX IF NOT EXISTS idx_questions_b ON questions(b)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(b, c, d)');
  }

  /**
   * Atomically claims a batch of unprocessed questions.
   * Uses transactions to prevent multiple workers from claiming the same questions.
   */
  claimBatch(batchSize: number): Question[] {
    const transaction = this.db.transaction(() => {
      // 1. Find available question IDs
      const ids = this.db.query(`
        SELECT id FROM questions
        WHERE processing_status = 'unprocessed'
        LIMIT ?
      `).all(batchSize) as Array<{ id: string }>;

      if (ids.length === 0) return [];

      // 2. Atomically claim them
      const idList = ids.map(r => r.id);
      const placeholders = idList.map(() => '?').join(',');
      this.db.run(`
        UPDATE questions
        SET processing_status = 'processing'
        WHERE id IN (${placeholders})
      `, ...idList);

      // 3. Return full question data
      return this.db.query(`
        SELECT * FROM questions
        WHERE id IN (${placeholders})
      `).all(...idList) as Question[];
    });

    return transaction();
  }

  /**
   * Legacy method for backward compatibility.
   * New code should use claimBatch() instead.
   */
  getUnprocessedBatch(batchSize: number): Question[] {
    const query = this.db.query(`
      SELECT * FROM questions
      WHERE processing_status = 'unprocessed'
      LIMIT ?
    `);
    return query.all(batchSize) as Question[];
  }

  /**
   * Updates a batch of processed questions and sets their status.
   */
  updateBatch(processed: ProcessedQuestion[], status: 'completed' | 'unprocessed' = 'completed'): void {
    const update = this.db.prepare(`
      UPDATE questions
      SET question = ?, a = ?, b = ?, c = ?, d = ?, metadata = ?, processing_status = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction((questions: ProcessedQuestion[]) => {
      for (const q of questions) {
        update.run(q.question, q.a, q.b, q.c, q.d, q.metadata || '', status, q.id);
      }
    });

    transaction(processed);
  }

  /**
   * Marks a batch of questions as failed by resetting their status to unprocessed.
   */
  markBatchFailed(questionIds: string[]): void {
    if (questionIds.length === 0) return;

    const placeholders = questionIds.map(() => '?').join(',');
    this.db.run(`
      UPDATE questions
      SET processing_status = 'unprocessed'
      WHERE id IN (${placeholders})
    `, ...questionIds);
  }

  getTotalQuestions(): number {
    const result = this.db.query('SELECT COUNT(*) as count FROM questions').get() as { count: number };
    return result.count;
  }

  getUnprocessedCount(): number {
    const result = this.db.query(`
      SELECT COUNT(*) as count FROM questions
      WHERE processing_status = 'unprocessed'
    `).get() as { count: number };
    return result.count;
  }
}
