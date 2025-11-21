import type { Question, ProcessedQuestion } from './types';

export class GeminiClient {
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

  constructor(private apiKey: string) {}

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

    return JSON.parse(cleaned);
  }

  async processBatch(questions: Question[]): Promise<ProcessedQuestion[]> {
    const prompt = this.buildPrompt(questions);

    const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response structure from Gemini API');
    }

    const text = data.candidates[0].content.parts[0].text;
    return this.parseResponse(text);
  }
}
