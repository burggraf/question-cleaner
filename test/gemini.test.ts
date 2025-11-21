import { describe, test, expect, mock } from 'bun:test';
import { GeminiClient } from '../src/gemini';
import type { Question } from '../src/types';

describe('GeminiClient', () => {
  test('buildPrompt creates proper JSON request', () => {
    const client = new GeminiClient('fake-key');
    const questions: Question[] = [{
      id: 'test1',
      question: 'River mentioned most often in the Bible',
      a: 'the Jordan',
      b: '', c: '', d: '',
      category: 'LAKES & RIVERS',
      air_date: '1984-09-10',
      round: 1,
      clue_value: 100,
      daily_double_value: 0,
      comments: '',
      notes: '',
      original_question: 'River mentioned most often in the Bible',
      metadata: '',
    }];

    const prompt = client.buildPrompt(questions);
    expect(prompt).toContain('River mentioned most often in the Bible');
    expect(prompt).toContain('the Jordan');
    expect(prompt).toContain('LAKES & RIVERS');
    expect(prompt).toContain('1984-09-10');
  });

  test('parseResponse extracts JSON from markdown', () => {
    const client = new GeminiClient('fake-key');
    const response = '```json\n[{"id":"test1","question":"What is X?","a":"A","b":"B","c":"C","d":"D"}]\n```';
    const result = client.parseResponse(response);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test1');
  });

  test('parseResponse handles plain JSON', () => {
    const client = new GeminiClient('fake-key');
    const response = '[{"id":"test1","question":"What is X?","a":"A","b":"B","c":"C","d":"D"}]';
    const result = client.parseResponse(response);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test1');
  });

  test('parseResponse throws on invalid JSON', () => {
    const client = new GeminiClient('fake-key');
    expect(() => client.parseResponse('not json')).toThrow();
  });
});
