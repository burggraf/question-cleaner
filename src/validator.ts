import type { ProcessedQuestion } from './types';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class Validator {
  validate(question: ProcessedQuestion): ValidationResult {
    // Check uniqueness
    const options = [question.a, question.b, question.c, question.d];
    const uniqueOptions = new Set(options);
    if (uniqueOptions.size !== 4) {
      return { valid: false, reason: `Options not unique for question ${question.id}` };
    }

    // Check non-empty
    for (const option of options) {
      if (!option || option.trim().length === 0) {
        return { valid: false, reason: `Empty option found for question ${question.id}` };
      }
    }

    // Check metadata JSON
    if (question.metadata) {
      try {
        JSON.parse(question.metadata);
      } catch {
        return { valid: false, reason: `Invalid JSON metadata for question ${question.id}` };
      }
    }

    return { valid: true };
  }

  validateBatch(questions: ProcessedQuestion[]): ValidationResult {
    for (const question of questions) {
      const result = this.validate(question);
      if (!result.valid) {
        return result;
      }
    }
    return { valid: true };
  }
}
