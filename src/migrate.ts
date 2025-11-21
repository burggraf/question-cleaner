import { Database } from 'bun:sqlite';

export function migrateDatabase(db: Database): void {
  console.log('Running database migrations...');

  // Check if migration already applied
  const tableInfo = db.query("PRAGMA table_info(questions)").all() as Array<{ name: string }>;
  const hasStatusColumn = tableInfo.some(col => col.name === 'processing_status');

  if (hasStatusColumn) {
    console.log('Migration already applied, skipping.');
    return;
  }

  // Add processing_status column
  console.log('Adding processing_status column...');
  db.run('ALTER TABLE questions ADD COLUMN processing_status TEXT DEFAULT "unprocessed"');

  // Create index
  console.log('Creating index on processing_status...');
  db.run('CREATE INDEX IF NOT EXISTS idx_processing_status ON questions(processing_status)');

  // Migrate existing data
  console.log('Migrating existing data...');
  const result = db.run(`
    UPDATE questions
    SET processing_status = 'completed'
    WHERE b IS NOT NULL AND b != '' AND b != ' '
  `);

  console.log(`Migration complete. Marked ${result.changes} questions as completed.`);
}

export function resetStuckBatches(db: Database): void {
  const result = db.run(`
    UPDATE questions
    SET processing_status = 'unprocessed'
    WHERE processing_status = 'processing'
  `);

  if (result.changes > 0) {
    console.log(`Reset ${result.changes} stuck batches from previous run.`);
  }
}
