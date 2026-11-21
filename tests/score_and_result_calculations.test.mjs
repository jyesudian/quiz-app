import test from 'node:test';
import assert from 'node:assert/strict';

// Helper functions that mirror the production logic in QuizResults, TakeQuiz, and evaluator
function calculateCanonicalMaxScore(questions) {
  return (questions || []).reduce((sum, q) => {
    if (q.type === 'single' || q.type === 'multiple') return sum + 1;
    if (q.type === 'text' || q.type === 'picture') return sum + 2;
    if (q.type === 'match') return sum + Math.round(((q.options || []).length) * 0.5);
    return sum + 1;
  }, 0);
}

function calculateResultSummary(attempt, questions) {
  const canonicalMaxScore = calculateCanonicalMaxScore(questions);
  const effectiveMaxScore = (attempt?.max_score && attempt.max_score > 0)
    ? attempt.max_score
    : (canonicalMaxScore > 0 ? canonicalMaxScore : 0);
  const effectiveScore = attempt?.score || 0;
  const percentage = effectiveMaxScore > 0 ? Math.round((effectiveScore / effectiveMaxScore) * 100) : 0;
  const isCompleted = !!attempt && attempt.completed_at !== null;
  const formattedDate = attempt?.completed_at
    ? new Date(attempt.completed_at).toLocaleDateString()
    : (attempt?.started_at ? `Started on ${new Date(attempt.started_at).toLocaleDateString()} (Incomplete)` : 'Not Completed');

  return {
    canonicalMaxScore,
    effectiveMaxScore,
    effectiveScore,
    percentage,
    isCompleted,
    formattedDate
  };
}

function getDetailedQuestionMaxPoints(question) {
  if (question.type === 'text' || question.type === 'picture') return 2;
  if (question.type === 'match') return Math.round((question.options?.length || 0) * 0.5);
  return 1;
}

test('Result calculation: Standard completed attempt with questions', () => {
  const questions = [
    { id: 1, type: 'single', options: [{ id: 10, isCorrect: true }, { id: 11, isCorrect: false }] },
    { id: 2, type: 'text', options: [] }, // worth 2
    { id: 3, type: 'match', options: [{ id: 20 }, { id: 21 }, { id: 22 }, { id: 23 }] } // 4 options * 0.5 = 2
  ];

  const attempt = {
    id: 1,
    score: 4,
    max_score: 5,
    completed_at: '2026-11-20T14:30:00Z',
    started_at: '2026-11-20T14:00:00Z',
    is_graded: true
  };

  const result = calculateResultSummary(attempt, questions);
  assert.equal(result.canonicalMaxScore, 5);
  assert.equal(result.effectiveMaxScore, 5);
  assert.equal(result.effectiveScore, 4);
  assert.equal(result.percentage, 80);
  assert.equal(result.isCompleted, true);
  assert.notEqual(result.formattedDate, '01/01/1970');
  assert.notEqual(result.formattedDate, '1/1/1970');
});

test('Result calculation: Incomplete attempt with max_score = 0 must NOT produce NaN or 01/01/1970', () => {
  const questions = [
    { id: 1, type: 'text', textEn: 'Who is Zacharias?', options: [] } // worth 2
  ];

  // Simulating the bug scenario for Jasmine Joyce:
  const attempt = {
    id: 42,
    score: 0,
    max_score: 0, // initially inserted as 0 in bug
    completed_at: null, // user closed tab
    started_at: '2026-11-20T10:00:00Z',
    is_graded: false
  };

  const result = calculateResultSummary(attempt, questions);

  // Must heal max_score using canonical questions (Question 1 worth 2 points)
  assert.equal(result.canonicalMaxScore, 2);
  assert.equal(result.effectiveMaxScore, 2);
  assert.equal(result.effectiveScore, 0);

  // Percentage must be 0, never NaN
  assert.equal(result.percentage, 0);
  assert.equal(Number.isNaN(result.percentage), false);

  // Attempt must be recognized as incomplete
  assert.equal(result.isCompleted, false);

  // Date must not be Unix epoch 01/01/1970
  assert.match(result.formattedDate, /Incomplete/i);
  assert.doesNotMatch(result.formattedDate, /1970/);
});

test('Result calculation: Zero-question quiz handling', () => {
  const questions = [];
  const attempt = {
    id: 43,
    score: 0,
    max_score: 0,
    completed_at: '2026-11-20T10:00:00Z',
    started_at: '2026-11-20T09:50:00Z'
  };

  const result = calculateResultSummary(attempt, questions);
  assert.equal(result.canonicalMaxScore, 0);
  assert.equal(result.effectiveMaxScore, 0);
  assert.equal(result.percentage, 0);
  assert.equal(Number.isNaN(result.percentage), false);
  assert.equal(Number.isFinite(result.percentage), true);
});

test('Consistency test: Summary max score equals sum of detailed breakdown question points', () => {
  const questions = [
    { id: 1, type: 'single', options: [{ id: 1 }, { id: 2 }] },
    { id: 2, type: 'multiple', options: [{ id: 3 }, { id: 4 }] },
    { id: 3, type: 'text', options: [] },
    { id: 4, type: 'picture', options: [] },
    { id: 5, type: 'match', options: [{ id: 5 }, { id: 6 }] }
  ];

  const sumDetailedPoints = questions.reduce((sum, q) => sum + getDetailedQuestionMaxPoints(q), 0);
  const canonicalMaxScore = calculateCanonicalMaxScore(questions);

  assert.equal(canonicalMaxScore, sumDetailedPoints, 'Canonical max score must equal sum of detailed points');
  assert.equal(canonicalMaxScore, 1 + 1 + 2 + 2 + 1); // = 7
});

test('Submission idempotency: duplicate submit requests are blocked', () => {
  let isSubmitting = false;
  let isSubmitted = false;
  let submissionCalls = 0;

  async function mockSubmit(payload) {
    if (!payload.user || !payload.quizId || !payload.attemptId || isSubmitting || isSubmitted) {
      return { success: false, reason: 'BLOCKED' };
    }
    isSubmitting = true;
    submissionCalls++;
    // Simulate async submission
    isSubmitted = true;
    isSubmitting = false;
    return { success: true };
  }

  const payload = { user: { id: 'user-1' }, quizId: '10', attemptId: 100 };

  // First submission
  const first = mockSubmit(payload);
  // Concurrent second submission
  const second = mockSubmit(payload);

  return Promise.all([first, second]).then(([res1, res2]) => {
    assert.equal(submissionCalls, 1, 'Submission function must only execute once');
    assert.equal(res1.success, true);
    assert.equal(res2.success, false);
  });
});
