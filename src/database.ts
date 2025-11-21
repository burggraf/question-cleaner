import { Database } from 'bun:sqlite';
import type { Question, ProcessedQuestion } from './types';

export class DatabaseClient {
  constructor(private db: Database) {}

  createIndexes(): void {
    this.db.run('CREATE INDEX IF NOT EXISTS idx_questions_b ON questions(b)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(b, c, d)');
  }

  getUnprocessedBatch(batchSize: number): Question[] {
    const query = this.db.query(`
      SELECT * FROM questions
      WHERE (b IS NULL OR b = '' OR b = ' ')
      LIMIT ?
    `);
    return query.all(batchSize) as Question[];
  }

  updateBatch(processed: ProcessedQuestion[]): void {
    const update = this.db.prepare(`
      UPDATE questions
      SET question = ?, a = ?, b = ?, c = ?, d = ?, metadata = ?
      WHERE id = ?
    `);

    const transaction = this.db.transaction((questions: ProcessedQuestion[]) => {
      for (const q of questions) {
        update.run(q.question, q.a, q.b, q.c, q.d, q.metadata || '', q.id);
      }
    });

    transaction(processed);
  }

  getTotalQuestions(): number {
    const result = this.db.query('SELECT COUNT(*) as count FROM questions').get() as { count: number };
    return result.count;
  }

  getUnprocessedCount(): number {
    const result = this.db.query(`
      SELECT COUNT(*) as count FROM questions
      WHERE (b IS NULL OR b = '' OR b = ' ')
    `).get() as { count: number };
    return result.count;
  }
}
