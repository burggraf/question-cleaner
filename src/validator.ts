import type { ProcessedQuestion } from './types';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class Validator {
  /**
   * Sanitizes a batch of questions by stripping invalid JSON metadata.
   * This allows us to salvage batches with minor metadata issues.
   */
  sanitizeBatch(questions: ProcessedQuestion[]): ProcessedQuestion[] {
    return questions.map(q => {
      // If metadata exists, validate it's proper JSON
      if (q.metadata) {
        try {
          JSON.parse(q.metadata);
          // Valid JSON, keep it
          return q;
        } catch {
          // Invalid JSON, strip it out
          return { ...q, metadata: undefined };
        }
      }
      return q;
    });
  }

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

    // Check metadata JSON (should already be sanitized)
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
