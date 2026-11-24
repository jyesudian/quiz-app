import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldEvaluateAnswer } from '../src/utils/evaluator.ts';

/**
 * Client Evaluator Zero-Score and Retry Tests
 * Covers all 6 scenarios required by TASK 4:
 * 1. Previously graded answer with score 0 (must be skipped, no Edge Function invocation)
 * 2. Previously graded answer with positive score (must be skipped, no Edge Function invocation)
 * 3. Failed answer eligible for retry (must be evaluated)
 * 4. Pending answer eligible for grading (must be evaluated)
 * 5. Legacy record with missing grading_status (backward compatibility without truthiness bugs)
 * 6. Retry after a genuine failure (simulation of lifecycle state transition)
 */

test('EVAL 1: Previously graded answer with score 0 is skipped (no unnecessary Edge Function invocation)', () => {
  const ans = {
    id: 101,
    grading_status: 'graded',
    ai_score: 0,
    is_correct: false
  };

  const shouldEval = shouldEvaluateAnswer(ans);
  assert.equal(shouldEval, false, 'Graded answer with score 0 must NOT be evaluated again');
});

test('EVAL 2: Previously graded answer with positive score (2) is skipped', () => {
  const ans = {
    id: 102,
    grading_status: 'graded',
    ai_score: 2,
    is_correct: true
  };

  const shouldEval = shouldEvaluateAnswer(ans);
  assert.equal(shouldEval, false, 'Graded answer with positive score must NOT be evaluated again');
});

test('EVAL 3: Previously graded answer with partial score (1) is skipped', () => {
  const ans = {
    id: 103,
    grading_status: 'graded',
    ai_score: 1,
    is_correct: false
  };

  const shouldEval = shouldEvaluateAnswer(ans);
  assert.equal(shouldEval, false, 'Graded answer with partial score must NOT be evaluated again');
});

test('EVAL 4: Failed answer (grading_status="failed") is eligible for retry even if ai_score is 0', () => {
  const ans = {
    id: 104,
    grading_status: 'failed',
    ai_score: 0,
    is_correct: false
  };

  const shouldEval = shouldEvaluateAnswer(ans);
  assert.equal(shouldEval, true, 'Failed answer must be eligible for retry');
});

test('EVAL 5: Retry_pending answer (grading_status="retry_pending") is eligible for evaluation', () => {
  const ans = {
    id: 105,
    grading_status: 'retry_pending',
    ai_score: 0,
    is_correct: false
  };

  const shouldEval = shouldEvaluateAnswer(ans);
  assert.equal(shouldEval, true, 'retry_pending answer must be evaluated');
});

test('EVAL 6: Pending answer (grading_status="pending") is eligible for grading', () => {
  const ans = {
    id: 106,
    grading_status: 'pending',
    ai_score: null,
    is_correct: null
  };

  const shouldEval = shouldEvaluateAnswer(ans);
  assert.equal(shouldEval, true, 'Pending answer must be evaluated');
});

test('EVAL 7: Legacy record lacking grading_status (null/undefined) with positive score is skipped', () => {
  // Legacy positive score (e.g. 2 points)
  const legacyFull = {
    id: 107,
    grading_status: null,
    ai_score: 2,
    is_correct: true
  };
  assert.equal(shouldEvaluateAnswer(legacyFull), false, 'Legacy positive score must be skipped');

  // Legacy partial score (1 point)
  const legacyPartial = {
    id: 108,
    grading_status: undefined,
    ai_score: 1,
    is_correct: false
  };
  assert.equal(shouldEvaluateAnswer(legacyPartial), false, 'Legacy partial score must be skipped');
});

test('EVAL 8: Legacy record lacking grading_status (null/undefined) with un-graded score (null or 0) is evaluated', () => {
  // Legacy un-graded (ai_score is null)
  const legacyUnset = {
    id: 109,
    grading_status: null,
    ai_score: null,
    is_correct: null
  };
  assert.equal(shouldEvaluateAnswer(legacyUnset), true, 'Legacy record with null score must be evaluated');

  // Legacy record where ai_score is 0 but status was never marked graded (initial default)
  const legacyZero = {
    id: 110,
    grading_status: null,
    ai_score: 0,
    is_correct: false
  };
  assert.equal(shouldEvaluateAnswer(legacyZero), true, 'Legacy record with 0 and null status must be evaluated');
});

test('EVAL 9: Retry lifecycle state transition simulation (failed -> retry -> graded -> permanent skip)', () => {
  // Step 1: Initial failed attempt
  const answer = {
    id: 111,
    grading_status: 'failed',
    ai_score: 0,
    is_correct: false
  };

  // Check 1: Must be eligible for retry
  assert.equal(shouldEvaluateAnswer(answer), true, 'Initial failed answer must be evaluated on retry');

  // Step 2: Evaluation succeeds and marks row as graded with zero score (e.g. student got question wrong)
  answer.grading_status = 'graded';
  answer.ai_score = 0;
  answer.is_correct = false;

  // Check 2: On subsequent retry or refetch, must be permanently skipped!
  assert.equal(shouldEvaluateAnswer(answer), false, 'Once graded (even with score 0), answer must be permanently skipped');
});
