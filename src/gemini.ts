import type { Question, ProcessedQuestion } from './types';

export class GeminiClient {
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  private apiKeys: string[];
  private currentKeyIndex: number = 0;
  private readonly KEY_ROTATION_DELAY_MS = 5000; // 5 seconds

  constructor(apiKeys: string[]) {
    this.apiKeys = apiKeys;
  }

  /**
   * Rotates to the next API key with a 5-second delay.
   * Returns true if rotation was successful, false if all keys exhausted.
   */
  async rotateKey(): Promise<boolean> {
    if (this.apiKeys.length === 1) {
      // Only one key, can't rotate
      return false;
    }

    const oldIndex = this.currentKeyIndex;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;

    console.log(`\nRotating API key: ${oldIndex + 1} -> ${this.currentKeyIndex + 1} (of ${this.apiKeys.length})`);
    console.log(`Waiting ${this.KEY_ROTATION_DELAY_MS / 1000} seconds before continuing...\n`);

    await new Promise(resolve => setTimeout(resolve, this.KEY_ROTATION_DELAY_MS));
    return true;
  }

  getCurrentKey(): string {
    return this.apiKeys[this.currentKeyIndex];
  }

  getKeyCount(): number {
    return this.apiKeys.length;
  }

  buildPrompt(questions: Question[]): string {
    const systemPrompt = `You are a quiz question formatter. Convert Jeopardy-style clues into proper multiple-choice questions.

REQUIREMENTS:
1. Reword the question to be in question form (not answer form)
2. Keep the answer in field 'a' correct
3. If the answer is outdated or incorrect (time has passed), update field 'a' and add metadata: {"issue": "explanation"}
4. Generate 3 plausible but clearly incorrect distractors for b, c, d
5. If question is ambiguous, unclear, or problematic, add metadata: {"ambiguous": "reason"}
6. Return ONLY a JSON array, no additional text

OUTPUT FORMAT:
[
  {
    "id": "question_id",
    "question": "Properly formatted question?",
    "a": "Correct answer",
    "b": "Plausible distractor 1",
    "c": "Plausible distractor 2",
    "d": "Plausible distractor 3",
    "metadata": "Optional JSON string if issues found"
  }
]

QUESTIONS:
`;

    const questionsText = questions.map(q =>
      `ID: ${q.id}\nCategory: ${q.category}\nAir Date: ${q.air_date}\nClue: ${q.question}\nAnswer: ${q.a}`
    ).join('\n\n');

    return systemPrompt + questionsText;
  }

  parseResponse(response: string): ProcessedQuestion[] {
    // Remove markdown code blocks if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array from Gemini, got: ' + typeof parsed);
    }
    return parsed;
  }

  async processBatch(questions: Question[]): Promise<ProcessedQuestion[]> {
    const prompt = this.buildPrompt(questions);

    const response = await fetch(`${this.apiUrl}?key=${this.getCurrentKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 65536,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error(`Invalid response structure from Gemini API. Response: ${JSON.stringify(data)}`);
    }

    const candidate = data.candidates[0];

    // Check for blocked content or safety issues
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Gemini API blocked response. Reason: ${candidate.finishReason}. Full candidate: ${JSON.stringify(candidate)}`);
    }

    const content = candidate.content;
    if (!content.parts || !content.parts[0] || !content.parts[0].text) {
      throw new Error(`Invalid content structure from Gemini API. Full response: ${JSON.stringify(data)}`);
    }

    const text = content.parts[0].text;
    return this.parseResponse(text);
  }
}
