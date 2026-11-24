import test from 'node:test';
import assert from 'node:assert/strict';

function normalizeAnswerText(text) {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ');
}

function evaluateExactMatch(studentAnswer, aiRubric) {
  if (!studentAnswer || !aiRubric) return null;

  const cleanStudent = normalizeAnswerText(studentAnswer);
  const cleanRubric = normalizeAnswerText(aiRubric);

  if (!cleanStudent || !cleanRubric) return null;

  if (cleanStudent === cleanRubric) {
    return { points: 2, isCorrect: true, method: 'exact_match' };
  }

  const rawAlternatives = aiRubric.split(/\s*[\/|]\s*|\s+or\s+/i);
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

// Jessie's actual attempt questions and answers from production
const jessieAttemptData = [
  {
    questionNumber: 1,
    type: 'picture',
    questionText: 'Decode the event',
    studentAnswer: 'Zechariah becomes mute',
    rubric: 'Zechariah Vision Mute',
    maxPoints: 2
  },
  {
    questionNumber: 2,
    type: 'text',
    questionText: 'Identify the promise concerning John',
    studentAnswer: 'He will be John and then Zechariah speaks',
    rubric: 'Zechariah John Song',
    maxPoints: 2
  },
  {
    questionNumber: 3,
    type: 'text',
    questionText: 'What happened when Elizabeth heard Mary greeting?',
    studentAnswer: "Elizabeth's John leaps",
    rubric: 'Mary, Elizabeth, John, Womb, Leap',
    maxPoints: 2
  },
  {
    questionNumber: 4,
    type: 'text',
    questionText: 'Identify the person referred to as Friend of God',
    studentAnswer: 'Theophilus',
    rubric: 'Theophilus',
    maxPoints: 2
  },
  {
    questionNumber: 5,
    type: 'single',
    questionText: 'Magnificat question',
    studentAnswer: 104, // Correct option
    correctOptionId: 104,
    maxPoints: 1
  }
];

function simulateGradingPipeline(questions, aiAvailable) {
  let attemptTotalScore = 0;
  let anyAiFailed = false;
  const gradedQuestions = [];

  for (const q of questions) {
    if (q.type === 'single') {
      const isCorrect = q.studentAnswer === q.correctOptionId;
      const pts = isCorrect ? 1 : 0;
      attemptTotalScore += pts;
      gradedQuestions.push({
        qNum: q.questionNumber,
        points: pts,
        status: isCorrect ? 'Correct' : 'Incorrect',
        method: 'deterministic'
      });
      continue;
    }

    // Text / Picture questions
    // 1. Conservative Exact-match fast path
    const fastPath = evaluateExactMatch(q.studentAnswer, q.rubric);
    if (fastPath) {
      attemptTotalScore += fastPath.points;
      gradedQuestions.push({
        qNum: q.questionNumber,
        points: fastPath.points,
        status: 'Correct',
        method: 'exact_match'
      });
      continue;
    }

    // 2. AI Evaluation
    if (!aiAvailable) {
      anyAiFailed = true;
      // CRITICAL NEW BEHAVIOR: Answer is NOT marked 0 points!
      // Status is "Evaluating..." or "Retry Pending", and points are not finalized.
      gradedQuestions.push({
        qNum: q.questionNumber,
        points: 0,
        status: 'Evaluating...',
        method: 'pending_ai'
      });
      continue;
    }

    // When AI is available, simulate semantic grading
    let simulatedScoreTen = 0;
    if (q.questionNumber === 1) simulatedScoreTen = 9.0; // "Zechariah becomes mute" captures core
    if (q.questionNumber === 2) simulatedScoreTen = 8.0; // "He will be John and then Zechariah speaks" captures core
    if (q.questionNumber === 3) simulatedScoreTen = 8.5; // "Elizabeth's John leaps" captures core

    let points = 0;
    if (simulatedScoreTen >= 7.5) points = 2;
    else if (simulatedScoreTen >= 2.0) points = 1;

    attemptTotalScore += points;
    gradedQuestions.push({
      qNum: q.questionNumber,
      points: points,
      status: points === 2 ? 'Correct' : 'Partially Correct',
      method: 'ai'
    });
  }

  const isAttemptGraded = !anyAiFailed;
  return {
    totalScore: attemptTotalScore,
    isGraded: isAttemptGraded,
    questions: gradedQuestions
  };
}

test("Jessie's Attempt Simulation 1: AI Unavailable / Edge Function Failure", () => {
  const result = simulateGradingPipeline(jessieAttemptData, false);

  // Question 4 (Theophilus) is evaluated via exact match fast-path even if AI is completely down!
  const q4 = result.questions.find(q => q.qNum === 4);
  assert.equal(q4.points, 2, 'Question 4 (Theophilus) must receive full credit via exact-match fast-path');
  assert.equal(q4.method, 'exact_match');

  // Question 5 (MCQ) is correct
  const q5 = result.questions.find(q => q.qNum === 5);
  assert.equal(q5.points, 1);

  // Subjective questions 1, 2, 3 must NOT be marked "Incorrect 0/2"
  const q1 = result.questions.find(q => q.qNum === 1);
  const q2 = result.questions.find(q => q.qNum === 2);
  const q3 = result.questions.find(q => q.qNum === 3);

  assert.equal(q1.status, 'Evaluating...', 'Q1 must remain in Evaluating... state');
  assert.equal(q2.status, 'Evaluating...', 'Q2 must remain in Evaluating... state');
  assert.equal(q3.status, 'Evaluating...', 'Q3 must remain in Evaluating... state');

  // Attempt must NOT be marked is_graded=true
  assert.equal(result.isGraded, false, 'Attempt must NOT be marked is_graded=true when AI is unavailable');
});

test("Jessie's Attempt Simulation 2: AI Available / Recovery & Correct Grading", () => {
  const result = simulateGradingPipeline(jessieAttemptData, true);

  // All 5 questions must be graded
  assert.equal(result.isGraded, true, 'Attempt is marked is_graded=true once all questions succeed');

  const q1 = result.questions.find(q => q.qNum === 1);
  const q2 = result.questions.find(q => q.qNum === 2);
  const q3 = result.questions.find(q => q.qNum === 3);
  const q4 = result.questions.find(q => q.qNum === 4);
  const q5 = result.questions.find(q => q.qNum === 5);

  assert.equal(q1.points, 2);
  assert.equal(q2.points, 2);
  assert.equal(q3.points, 2);
  assert.equal(q4.points, 2);
  assert.equal(q5.points, 1);

  // Total score: 2 + 2 + 2 + 2 + 1 = 9 / 9 (100%)
  assert.equal(result.totalScore, 9);
});
