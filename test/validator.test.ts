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

  test('sanitizeBatch strips invalid JSON metadata', () => {
    const batch: ProcessedQuestion[] = [
      {
        id: '1',
        question: 'What is X?',
        a: 'Answer A',
        b: 'Answer B',
        c: 'Answer C',
        d: 'Answer D',
        metadata: '{invalid json}',
      },
    ];
    const sanitized = validator.sanitizeBatch(batch);
    expect(sanitized[0].metadata).toBeUndefined();
  });

  test('sanitizeBatch preserves valid JSON metadata', () => {
    const batch: ProcessedQuestion[] = [
      {
        id: '1',
        question: 'What is X?',
        a: 'Answer A',
        b: 'Answer B',
        c: 'Answer C',
        d: 'Answer D',
        metadata: '{"issue": "test"}',
      },
    ];
    const sanitized = validator.sanitizeBatch(batch);
    expect(sanitized[0].metadata).toBe('{"issue": "test"}');
  });

  test('sanitizeBatch handles mixed valid and invalid metadata', () => {
    const batch: ProcessedQuestion[] = [
      {
        id: '1',
        question: 'What is X?',
        a: 'A1',
        b: 'B1',
        c: 'C1',
        d: 'D1',
        metadata: '{"valid": true}',
      },
      {
        id: '2',
        question: 'What is Y?',
        a: 'A2',
        b: 'B2',
        c: 'C2',
        d: 'D2',
        metadata: '{invalid',
      },
      {
        id: '3',
        question: 'What is Z?',
        a: 'A3',
        b: 'B3',
        c: 'C3',
        d: 'D3',
      },
    ];
    const sanitized = validator.sanitizeBatch(batch);
    expect(sanitized[0].metadata).toBe('{"valid": true}');
    expect(sanitized[1].metadata).toBeUndefined();
    expect(sanitized[2].metadata).toBeUndefined();
  });
});
