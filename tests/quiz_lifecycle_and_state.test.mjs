import test from 'node:test';
import assert from 'node:assert/strict';

// Evaluates the quiz load state based on responses
function resolveQuizLoadState({ quiz, quizError, questions, questionsError, user, enrollments }) {
  if (quizError) {
    return { status: 'ERROR', title: 'Failed to Load Quiz', message: quizError.message };
  }

  if (!quiz) {
    const pendingEnrollment = (enrollments || []).find(e => e.status === 'pending');
    if (pendingEnrollment) {
      return {
        status: 'PENDING_APPROVAL',
        title: 'Enrollment Pending',
        message: 'Your enrollment request is pending approval.'
      };
    }
    return {
      status: 'UNAUTHORIZED',
      title: 'Access Restricted',
      message: 'You must be enrolled and approved in this series.'
    };
  }

  if (quiz.status !== 'published' && user.role !== 'admin') {
    return {
      status: 'DRAFT',
      title: 'Quiz Not Available',
      message: 'This quiz is currently in draft mode.'
    };
  }

  if (questionsError) {
    return {
      status: 'ERROR',
      title: 'Failed to Load Questions',
      message: questionsError.message
    };
  }

  if (!questions || questions.length === 0) {
    return {
      status: 'EMPTY',
      title: 'No Questions Found',
      message: 'This quiz does not have any questions configured yet.'
    };
  }

  return {
    status: 'READY',
    questions: questions
  };
}

// Student dashboard attempt state resolver
function resolveDashboardQuizState(quiz, attemptsList) {
  const attempt = (attemptsList || []).find(a => a.quiz_id === quiz.id);
  const isCompleted = !!attempt && attempt.completed_at !== null;
  const isInProgress = !!attempt && !attempt.completed_at;

  return {
    id: quiz.id,
    title: quiz.title,
    isAttempted: isCompleted,
    isInProgress: isInProgress,
    attemptId: attempt ? attempt.id : null
  };
}

test('Quiz Loading: Differentiates Unauthorized / Pending from "No questions found"', () => {
  // Case A: Quiz not accessible because user enrollment is pending
  const statePending = resolveQuizLoadState({
    quiz: null,
    quizError: null,
    user: { id: 'u1', role: 'student' },
    enrollments: [{ series_id: 1, status: 'pending' }]
  });

  assert.equal(statePending.status, 'PENDING_APPROVAL');
  assert.equal(statePending.title, 'Enrollment Pending');
  assert.notEqual(statePending.title, 'No Questions Found');

  // Case B: Quiz is in draft mode
  const stateDraft = resolveQuizLoadState({
    quiz: { id: 10, title: 'Luke Chapter 1', status: 'draft' },
    quizError: null,
    user: { id: 'u1', role: 'student' }
  });
  assert.equal(stateDraft.status, 'DRAFT');
  assert.equal(stateDraft.title, 'Quiz Not Available');

  // Case C: Network error loading quiz
  const stateNetwork = resolveQuizLoadState({
    quiz: null,
    quizError: { message: 'Network connection failed' },
    user: { id: 'u1', role: 'student' }
  });
  assert.equal(stateNetwork.status, 'ERROR');

  // Case D: Genuinely empty published quiz
  const stateEmpty = resolveQuizLoadState({
    quiz: { id: 10, title: 'Empty Quiz', status: 'published' },
    questions: [],
    user: { id: 'u1', role: 'student' }
  });
  assert.equal(stateEmpty.status, 'EMPTY');

  // Case E: Successfully loaded quiz with questions
  const stateReady = resolveQuizLoadState({
    quiz: { id: 10, title: 'Luke Chapter 1', status: 'published' },
    questions: [{ id: 1, textEn: 'Question 1', type: 'single', options: [] }],
    user: { id: 'u1', role: 'student' }
  });
  assert.equal(stateReady.status, 'READY');
  assert.equal(stateReady.questions.length, 1);
});

test('Attempt creation safety: Attempt is NEVER created if questions fail to load or are empty', () => {
  let createdAttempts = [];

  function tryInitializeAttempt(loadState, user, quizId) {
    if (loadState.status !== 'READY') {
      // Must not create attempt
      return null;
    }
    const attempt = { id: 101, user_id: user.id, quiz_id: quizId, completed_at: null };
    createdAttempts.push(attempt);
    return attempt;
  }

  // 1. Loading fails due to network error
  const errState = { status: 'ERROR', message: 'Failed' };
  const att1 = tryInitializeAttempt(errState, { id: 'u1' }, 10);
  assert.equal(att1, null);
  assert.equal(createdAttempts.length, 0);

  // 2. Loading fails due to empty questions list
  const emptyState = { status: 'EMPTY' };
  const att2 = tryInitializeAttempt(emptyState, { id: 'u1' }, 10);
  assert.equal(att2, null);
  assert.equal(createdAttempts.length, 0);

  // 3. Loading succeeds
  const readyState = { status: 'READY', questions: [{ id: 1 }] };
  const att3 = tryInitializeAttempt(readyState, { id: 'u1' }, 10);
  assert.notEqual(att3, null);
  assert.equal(createdAttempts.length, 1);
});

test('Tab closure / Incomplete attempt: Dashboard treats incomplete attempt as "Open" with "Resume Quiz"', () => {
  const quiz = { id: 10, title: 'Luke Chapter 1' };

  // Scenario 1: User closed tab while taking quiz -> attempt has completed_at: null
  const inProgressAttempt = [{ id: 50, quiz_id: 10, completed_at: null }];
  const state1 = resolveDashboardQuizState(quiz, inProgressAttempt);

  assert.equal(state1.isAttempted, false, 'Incomplete attempt must NOT be marked as isAttempted (completed)');
  assert.equal(state1.isInProgress, true, 'Incomplete attempt must be marked as isInProgress');

  // Scenario 2: User successfully submitted quiz -> attempt has completed_at: timestamp
  const completedAttempt = [{ id: 50, quiz_id: 10, completed_at: '2026-11-20T12:00:00Z' }];
  const state2 = resolveDashboardQuizState(quiz, completedAttempt);

  assert.equal(state2.isAttempted, true, 'Completed attempt must be marked as isAttempted');
  assert.equal(state2.isInProgress, false, 'Completed attempt must not be marked as isInProgress');

  // Scenario 3: User never started quiz
  const noAttempt = [];
  const state3 = resolveDashboardQuizState(quiz, noAttempt);

  assert.equal(state3.isAttempted, false);
  assert.equal(state3.isInProgress, false);
});

test('Attempt lifecycle: Resumes in-progress attempt and restores previous answers', () => {
  const existingAttempt = { id: 77, completed_at: null, score: 0, max_score: 5 };
  const prevAnswers = [
    { question_id: 1, selected_option_id: 101, text_answer: null },
    { question_id: 2, selected_option_id: null, text_answer: JSON.stringify([201, 202]) }
  ];

  function handleAttemptCheck(existing, answers) {
    if (existing?.completed_at) {
      return { action: 'ALREADY_COMPLETED' };
    }
    if (existing && !existing.completed_at) {
      return {
        action: 'RESUME',
        attemptId: existing.id,
        answers: answers.reduce((acc, a) => {
          acc[a.question_id] = a.selected_option_id || JSON.parse(a.text_answer || 'null');
          return acc;
        }, {})
      };
    }
    return { action: 'CREATE_NEW' };
  }

  const result = handleAttemptCheck(existingAttempt, prevAnswers);
  assert.equal(result.action, 'RESUME');
  assert.equal(result.attemptId, 77);
  assert.equal(result.answers[1], 101);
  assert.deepEqual(result.answers[2], [201, 202]);
});

test('Attempt lifecycle: Retake prevention when attempt already completed (UNIQUE constraint integrity)', () => {
  const completedAttempt = { id: 88, completed_at: '2026-11-20T15:00:00Z', score: 9, max_score: 10 };

  function handleAttemptCheck(existing) {
    if (existing?.completed_at) {
      return { action: 'ALREADY_COMPLETED', canRetake: false };
    }
    return { action: 'RESUME_OR_CREATE', canRetake: true };
  }

  const result = handleAttemptCheck(completedAttempt);
  assert.equal(result.action, 'ALREADY_COMPLETED');
  assert.equal(result.canRetake, false, 'Completed attempts must not allow retakes due to UNIQUE(user_id, quiz_id)');
});
