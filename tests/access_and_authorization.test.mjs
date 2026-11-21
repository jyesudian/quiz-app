import test from 'node:test';
import assert from 'node:assert/strict';

// Simulates PostgreSQL RLS policy for public.quizzes:
// USING (
//   public.is_admin(auth.uid()) OR (
//     status = 'published' AND (
//       EXISTS (SELECT 1 FROM series_enrollments WHERE series_id = quizzes.series_id AND user_id = auth.uid() AND status = 'approved')
//       OR
//       EXISTS (SELECT 1 FROM quiz_series WHERE id = quizzes.series_id AND requires_approval = false)
//     )
//   )
// )
function evaluateQuizVisibilityRLS(quiz, series, user, enrollments) {
  // Admin bypass
  if (user.role === 'admin') {
    return true;
  }

  // Must be published for students
  if (quiz.status !== 'published') {
    return false;
  }

  // Open series does not require manual approval
  if (series && series.requires_approval === false) {
    return true;
  }

  // Otherwise requires approved enrollment
  const enrollment = (enrollments || []).find(
    e => e.series_id === quiz.series_id && e.user_id === user.id
  );
  return !!enrollment && enrollment.status === 'approved';
}

// Simulates PostgreSQL get_series_leaderboard RPC
function calculateSeriesLeaderboard(attempts, profiles) {
  // Only completed attempts (completed_at IS NOT NULL) are considered!
  const completedAttempts = attempts.filter(a => a.completed_at !== null);

  // Group latest attempt per user per quiz
  const userQuizMap = new Map();
  for (const att of completedAttempts) {
    const key = `${att.user_id}_${att.quiz_id}`;
    if (!userQuizMap.has(key) || new Date(att.completed_at) > new Date(userQuizMap.get(key).completed_at)) {
      userQuizMap.set(key, att);
    }
  }

  // Aggregate user scores
  const userScores = new Map();
  for (const att of userQuizMap.values()) {
    const current = userScores.get(att.user_id) || { score: 0, out_of: 0 };
    current.score += att.score;
    current.out_of += att.max_score;
    userScores.set(att.user_id, current);
  }

  // Rank users by score DESC
  const leaderboard = [];
  for (const [userId, scores] of userScores.entries()) {
    const profile = profiles.find(p => p.id === userId);
    leaderboard.push({
      user_id: userId,
      name: profile?.full_name || 'Student',
      score: scores.score,
      out_of: scores.out_of
    });
  }

  leaderboard.sort((a, b) => b.score - a.score);
  return leaderboard.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

test('RLS Simulation: Admin (jyesudian@gmail.com) can always view Luke-Chapter-1', () => {
  const adminUser = { id: 'admin-uuid', email: 'jyesudian@gmail.com', role: 'admin' };
  const series = { id: 1, title: 'Advent-Luke-Study', requires_approval: true };
  const quiz = { id: 10, series_id: 1, title: 'Luke-Chapter-1', status: 'published' };
  const enrollments = []; // Admin has no student enrollment record

  const canView = evaluateQuizVisibilityRLS(quiz, series, adminUser, enrollments);
  assert.equal(canView, true, 'Admin must be able to view quizzes regardless of enrollment');
});

test('RLS Simulation: Affected User (jasmine.joyce@gmail.com) with pending enrollment', () => {
  const studentUser = { id: 'jasmine-uuid', email: 'jasmine.joyce@gmail.com', role: 'student' };
  const series = { id: 1, title: 'Advent-Luke-Study', requires_approval: true };
  const quiz = { id: 10, series_id: 1, title: 'Luke-Chapter-1', status: 'published' };

  // Case 1: Enrollment request is still 'pending'
  const pendingEnrollments = [{ series_id: 1, user_id: 'jasmine-uuid', status: 'pending' }];
  const canViewPending = evaluateQuizVisibilityRLS(quiz, series, studentUser, pendingEnrollments);
  assert.equal(canViewPending, false, 'Student with pending enrollment must not view quiz before approval');

  // Case 2: Once admin approves enrollment ('approved')
  const approvedEnrollments = [{ series_id: 1, user_id: 'jasmine-uuid', status: 'approved' }];
  const canViewApproved = evaluateQuizVisibilityRLS(quiz, series, studentUser, approvedEnrollments);
  assert.equal(canViewApproved, true, 'Student with approved enrollment must be able to view published quiz');
});

test('RLS Simulation: Open series without approval requirement', () => {
  const studentUser = { id: 'student-2-uuid', email: 'student2@gmail.com', role: 'student' };
  const openSeries = { id: 2, title: 'Open Bible Study', requires_approval: false };
  const quiz = { id: 20, series_id: 2, title: 'Genesis 1', status: 'published' };
  const enrollments = []; // No manual enrollment row yet

  const canView = evaluateQuizVisibilityRLS(quiz, openSeries, studentUser, enrollments);
  assert.equal(canView, true, 'Students must be able to view published quizzes in open series');
});

test('Leaderboard ranking: Incomplete attempt (completed_at: null) must NEVER be ranked on leaderboard', () => {
  const profiles = [
    { id: 'u1', full_name: 'Student One' },
    { id: 'jasmine-uuid', full_name: 'Jasmine Joyce' }
  ];

  const attempts = [
    // Completed attempt for Student One
    { id: 1, user_id: 'u1', quiz_id: 10, score: 8, max_score: 10, completed_at: '2026-11-20T10:00:00Z' },
    // Incomplete attempt for Jasmine Joyce (tab closed before submission)
    { id: 2, user_id: 'jasmine-uuid', quiz_id: 10, score: 0, max_score: 0, completed_at: null }
  ];

  const leaderboard = calculateSeriesLeaderboard(attempts, profiles);

  // Jasmine must NOT be present in the leaderboard because attempt was never completed!
  const jasmineEntry = leaderboard.find(e => e.user_id === 'jasmine-uuid');
  assert.equal(jasmineEntry, undefined, 'User with incomplete attempt must not appear on leaderboard');

  // Student One should be #1
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].user_id, 'u1');
  assert.equal(leaderboard[0].rank, 1);
});
