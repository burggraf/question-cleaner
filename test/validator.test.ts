import { describe, test, expect } from 'bun:test';
import { Validator } from '../src/validator';
import type { ProcessedQuestion } from '../src/types';

describe('Validator', () => {
  const validator = new Validator();

  test('validates unique options', () => {
    const valid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
    };
    expect(validator.validate(valid)).toEqual({ valid: true });
  });

  test('rejects duplicate options', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer A',
      c: 'Answer C',
      d: 'Answer D',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not unique');
  });

  test('rejects empty options', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: '',
      c: 'Answer C',
      d: 'Answer D',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Empty');
  });

  test('rejects whitespace-only options', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: '   ',
      c: 'Answer C',
      d: 'Answer D',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Empty');
  });

  test('validates JSON metadata', () => {
    const valid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
      metadata: '{"issue": "test"}',
    };
    expect(validator.validate(valid)).toEqual({ valid: true });
  });

  test('rejects invalid JSON metadata', () => {
    const invalid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
      metadata: '{invalid json}',
    };
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('metadata');
  });

  test('allows empty metadata', () => {
    const valid: ProcessedQuestion = {
      id: '1',
      question: 'What is X?',
      a: 'Answer A',
      b: 'Answer B',
      c: 'Answer C',
      d: 'Answer D',
    };
    expect(validator.validate(valid)).toEqual({ valid: true });
  });
});
