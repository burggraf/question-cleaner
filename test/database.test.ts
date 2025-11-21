import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseClient } from '../src/database';
import type { Question, ProcessedQuestion } from '../src/types';

describe('DatabaseClient', () => {
  let db: Database;
  let client: DatabaseClient;

  beforeEach(() => {
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
    client = new DatabaseClient(db);
  });

  afterEach(() => {
    db.close();
  });

  test('createIndexes creates required indexes', () => {
    client.createIndexes();
    const indexes = db.query("SELECT name FROM sqlite_master WHERE type='index'").all();
    const indexNames = indexes.map((idx: any) => idx.name);
    expect(indexNames).toContain('idx_questions_b');
  });

  test('getUnprocessedBatch returns empty questions', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test2', 'Q2', 'A2', 'B2', 'C2', 'D2', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q2', '')`);

    const batch = client.getUnprocessedBatch(10);
    expect(batch.length).toBe(1);
    expect(batch[0].id).toBe('test1');
  });

  test('updateBatch updates multiple questions in transaction', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);

    const processed: ProcessedQuestion[] = [{
      id: 'test1',
      question: 'What is Q1?',
      a: 'A1',
      b: 'B1',
      c: 'C1',
      d: 'D1',
    }];

    client.updateBatch(processed);

    const result = db.query('SELECT * FROM questions WHERE id = ?').get('test1') as Question;
    expect(result.question).toBe('What is Q1?');
    expect(result.b).toBe('B1');
    expect(result.c).toBe('C1');
    expect(result.d).toBe('D1');
  });

  test('getTotalQuestions returns count', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);
    expect(client.getTotalQuestions()).toBe(1);
  });

  test('getUnprocessedCount returns count of empty b/c/d', () => {
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test1', 'Q1', 'A1', '', '', '', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q1', '')`);
    db.run(`INSERT INTO questions (id, question, a, b, c, d, category, air_date, round, clue_value, daily_double_value, comments, notes, original_question, metadata)
            VALUES ('test2', 'Q2', 'A2', 'B2', 'C2', 'D2', 'CAT', '2020-01-01', 1, 100, 0, '', '', 'Q2', '')`);
    expect(client.getUnprocessedCount()).toBe(1);
  });
});
