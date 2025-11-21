import { parseConfig } from './src/config';
import { QuestionProcessor } from './src/processor';

async function main() {
  try {
    const config = parseConfig();
    const processor = new QuestionProcessor(config);
    await processor.run();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
