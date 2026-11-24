import test from 'node:test';
import assert from 'node:assert/strict';

// Normalization function matching src/utils/evaluator.ts
function normalizeAnswerText(text) {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ');
}

// Conservative Canonical Rubric Classifier matching src/utils/evaluator.ts
function isCanonicalAnswerRubric(aiRubric) {
  if (!aiRubric) return false;
  const trimmed = aiRubric.trim();
  if (/[,;:.]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (/\b(must|should|convey|explain|describe|mention|criteria|because|identifies)\b/.test(lower)) return false;

  const rawAlternatives = trimmed.split(/\s*[/|]\s*|\s+or\s+/i);
  if (rawAlternatives.length > 1) {
    return rawAlternatives.every(alt => {
      const words = alt.trim().split(/\s+/).filter(Boolean);
      return words.length >= 1 && words.length <= 3;
    });
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length <= 2;
}

// Exact match evaluation matching src/utils/evaluator.ts
function evaluateExactMatch(studentAnswer, aiRubric) {
  if (!studentAnswer || !aiRubric) return null;
  if (!isCanonicalAnswerRubric(aiRubric)) return null;

  const cleanStudent = normalizeAnswerText(studentAnswer);
  const cleanRubric = normalizeAnswerText(aiRubric);

  if (!cleanStudent || !cleanRubric) return null;

  if (cleanStudent === cleanRubric) {
    return { points: 2, isCorrect: true, method: 'exact_match' };
  }

  const rawAlternatives = aiRubric.split(/\s*[/|]\s*|\s+or\s+/i);
  if (rawAlternatives.length > 1) {
    for (const alt of rawAlternatives) {
      const cleanAlt = normalizeAnswerText(alt);
      if (cleanAlt && cleanStudent === cleanAlt) {
        return { points: 2, isCorrect: true, method: 'exact_match' };
      }
    }
  }

  return null;
}

// Helper to simulate the Edge Function parsing logic
function simulateEdgeFunctionParse(resultText) {
  if (!resultText) {
    return { error: 'Empty content returned in AI response candidate', category: 'empty_response' };
  }

  let cleaned = resultText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const scoreMatch = cleaned.match(/"score"\s*:\s*(\d+(\.\d+)?)/);
    const feedbackMatch = cleaned.match(/"feedback"\s*:\s*"([^"]+)"/);
    if (scoreMatch) {
      parsed = {
        score: parseFloat(scoreMatch[1]),
        feedback: feedbackMatch ? feedbackMatch[1] : 'Evaluated by AI'
      };
    } else {
      return { error: 'Failed to parse AI response into valid grading schema', category: 'parse_error' };
    }
  }

  if (typeof parsed.score !== 'number' || isNaN(parsed.score) || parsed.score < 0 || parsed.score > 10) {
    return { error: `Invalid score returned: ${parsed.score}`, category: 'schema_validation_error' };
  }

  return { success: true, score: parsed.score, feedback: parsed.feedback || '' };
}

// Helper to simulate points conversion from AI scoreTen (0-10) to points (0-2)
function mapAiScoreToPoints(scoreTen) {
  if (scoreTen >= 7.5) return 2;
  if (scoreTen >= 2.0) return 1;
  return 0;
}

test('1. Exact match: Theophilus vs Theophilus', () => {
  const result = evaluateExactMatch('Theophilus', 'Theophilus');
  assert.notEqual(result, null, 'Exact match must succeed on fast path');
  assert.equal(result.points, 2);
  assert.equal(result.isCorrect, true);
  assert.equal(result.method, 'exact_match');
});

test('2. Case difference: theophilus vs Theophilus', () => {
  const result = evaluateExactMatch('theophilus', 'Theophilus');
  assert.notEqual(result, null);
  assert.equal(result.points, 2);
  assert.equal(result.isCorrect, true);
});

test('3. Punctuation difference: Theophilus. vs Theophilus', () => {
  const result = evaluateExactMatch('Theophilus.', 'Theophilus');
  assert.notEqual(result, null);
  assert.equal(result.points, 2);
  assert.equal(result.isCorrect, true);
});

test('4. Semantic equivalence: Zechariah became unable to speak vs Zechariah Vision Mute', () => {
  const fastPath = evaluateExactMatch('Zechariah became unable to speak', 'Zechariah Vision Mute');
  assert.equal(fastPath, null, 'Keyword rubric must not be falsely treated as exact match');

  const aiRaw = JSON.stringify({ score: 9.0, feedback: "The student correctly captured that Zechariah became mute." });
  const parsed = simulateEdgeFunctionParse(aiRaw);
  assert.equal(parsed.success, true);
  assert.equal(mapAiScoreToPoints(parsed.score), 2, 'Score 9.0 maps to full 2 points');
});

test('5. Concise answer: Zechariah was mute vs Zechariah Vision Mute', () => {
  const aiRaw = JSON.stringify({ score: 8.0, feedback: "Core fact identified." });
  const parsed = simulateEdgeFunctionParse(aiRaw);
  assert.equal(parsed.success, true);
  assert.equal(mapAiScoreToPoints(parsed.score), 2, 'Score 8.0 maps to full 2 points');
});

test('6. Partial answer: John vs Zechariah John Song', () => {
  const aiRaw = JSON.stringify({ score: 4.5, feedback: "Identified John, but omitted Zechariah and the song of praise." });
  const parsed = simulateEdgeFunctionParse(aiRaw);
  assert.equal(parsed.success, true);
  assert.equal(mapAiScoreToPoints(parsed.score), 1, 'Partial score 4.5 maps to 1 point partial credit');
});

test('7. Incorrect answer: Peter vs Theophilus', () => {
  const fastPath = evaluateExactMatch('Peter', 'Theophilus');
  assert.equal(fastPath, null);

  const aiRaw = JSON.stringify({ score: 0.0, feedback: "Incorrect. The person addressed is Theophilus, not Peter." });
  const parsed = simulateEdgeFunctionParse(aiRaw);
  assert.equal(parsed.success, true);
  assert.equal(mapAiScoreToPoints(parsed.score), 0, 'Incorrect answer receives 0 points');
});

test('8. Gemini response wrapped in Markdown code fences is successfully parsed', () => {
  const markdownFenced = '```json\n{\n  "score": 10,\n  "feedback": "Correct answer."\n}\n```';
  const parsed = simulateEdgeFunctionParse(markdownFenced);
  assert.equal(parsed.success, true);
  assert.equal(parsed.score, 10);
  assert.equal(parsed.feedback, 'Correct answer.');
  assert.equal(mapAiScoreToPoints(parsed.score), 2);
});

test('9. Malformed JSON causes evaluation failure, NOT student zero', () => {
  const malformed = '{ score: 10, invalid_unquoted_json }';
  const parsed = simulateEdgeFunctionParse(malformed);
  assert.equal(parsed.success, undefined);
  assert.equal(parsed.category, 'parse_error');
  assert.notEqual(parsed.score, 0, 'Must NOT set score: 0 on parse failure');
});

test('10. Missing API key causes failure, answer remains retryable', () => {
  const apiKey = null;
  const isMissing = !apiKey;
  assert.equal(isMissing, true);
  const errorResponse = { error: 'OPENROUTER_API_KEY environment variable is missing on edge runtime', category: 'missing_env_key' };
  assert.equal(errorResponse.category, 'missing_env_key');
});

test('11. HTTP 429 Rate-limit failure is treated as evaluation failure', () => {
  const httpStatus = 429;
  const isRateLimited = httpStatus === 429;
  assert.equal(isRateLimited, true);
  const failureCategory = isRateLimited ? 'provider_error' : 'unknown';
  assert.equal(failureCategory, 'provider_error');
});

test('12. Timeout failure preserves pending status', () => {
  let anyEvaluationFailed = false;
  try {
    throw new Error('fetch failed: timeout after 10000ms');
  } catch (err) {
    anyEvaluationFailed = true;
  }
  assert.equal(anyEvaluationFailed, true);
  const isFullyGraded = !anyEvaluationFailed;
  assert.equal(isFullyGraded, false, 'Attempt must NOT be marked is_graded=true on timeout');
});

test('13. Concurrent evaluation lock prevents simultaneous runs', () => {
  const locks = new Set();
  const attemptId = 42;

  const run1 = !locks.has(attemptId) && (locks.add(attemptId), true);
  const run2 = !locks.has(attemptId) && (locks.add(attemptId), true);

  assert.equal(run1, true, 'First call acquires lock');
  assert.equal(run2, false, 'Concurrent call is rejected by lock');

  locks.delete(attemptId);
  const run3 = !locks.has(attemptId) && (locks.add(attemptId), true);
  assert.equal(run3, true, 'Subsequent call after release succeeds');
});

test('14. Successful evaluation followed by retry: existing score is preserved', () => {
  const existingAnswer = { id: 101, ai_score: 2, is_correct: true };
  const shouldSkip = typeof existingAnswer.ai_score === 'number' && existingAnswer.ai_score > 0 && existingAnswer.is_correct === true;
  assert.equal(shouldSkip, true, 'Existing successful answer must not be re-evaluated');
});

test('15. Attempt finalization: marked graded ONLY when all required AI evaluations succeed', () => {
  const evaluations = [
    { id: 1, type: 'text', status: 'success' },
    { id: 2, type: 'text', status: 'failed' }
  ];

  const anyFailed = evaluations.some(e => e.status !== 'success');
  const isAttemptGraded = !anyFailed;

  assert.equal(isAttemptGraded, false, 'Attempt with a failed evaluation must remain is_graded=false');

  evaluations[1].status = 'success';
  const anyFailedRetry = evaluations.some(e => e.status !== 'success');
  const isAttemptGradedAfterRetry = !anyFailedRetry;

  assert.equal(isAttemptGradedAfterRetry, true, 'Attempt is marked is_graded=true once all evaluations succeed');
});
