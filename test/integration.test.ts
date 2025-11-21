import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseClient } from '../src/database';
import type { Question } from '../src/types';

describe('Integration Test', () => {
  let db: Database;
  let client: DatabaseClient;

  beforeAll(() => {
    // Create in-memory test database
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        round INTEGER,
        clue_value INTEGER,
        daily_double_value INTEGER,
        category TEXT,
        comments TEXT,
        question TEXT,
        a TEXT,
        b TEXT,
        c TEXT,
        d TEXT,
        air_date TEXT,
        notes TEXT,
        original_question TEXT,
        metadata TEXT
      )
    `);

    // Insert test data
    db.run(`
      INSERT INTO questions VALUES
      ('test1', 1, 100, 0, 'GEOGRAPHY', '', 'Largest ocean on Earth', 'Pacific Ocean', '', '', '', '2020-01-01', '', 'Largest ocean on Earth', ''),
      ('test2', 1, 200, 0, 'HISTORY', '', 'Year World War II ended', '1945', '', '', '', '2020-01-02', '', 'Year World War II ended', ''),
      ('test3', 1, 300, 0, 'SCIENCE', '', 'Symbol for gold', 'Au', 'Gold', 'G', 'Go', '2020-01-03', '', 'Symbol for gold', '')
    `);

    client = new DatabaseClient(db);
  });

  test('end-to-end: indexes, query, update flow', () => {
    // Create indexes
    client.createIndexes();

    // Get unprocessed count (only test1 and test2 have empty b/c/d)
    const unprocessed = client.getUnprocessedCount();
    expect(unprocessed).toBe(2);

    // Get batch
    const batch = client.getUnprocessedBatch(10);
    expect(batch.length).toBe(2);

    // Update batch
    client.updateBatch([
      {
        id: 'test1',
        question: 'What is the largest ocean on Earth?',
        a: 'Pacific Ocean',
        b: 'Atlantic Ocean',
        c: 'Indian Ocean',
        d: 'Arctic Ocean',
      },
      {
        id: 'test2',
        question: 'In what year did World War II end?',
        a: '1945',
        b: '1944',
        c: '1946',
        d: '1943',
      },
    ]);

    // Verify updates
    const updated = db.query('SELECT * FROM questions WHERE id = ?').get('test1') as Question;
    expect(updated.question).toBe('What is the largest ocean on Earth?');
    expect(updated.b).toBe('Atlantic Ocean');

    // Verify no more unprocessed
    const remaining = client.getUnprocessedCount();
    expect(remaining).toBe(0);
  });
});
