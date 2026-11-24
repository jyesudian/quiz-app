import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleGradeAnswer } from '../supabase/functions/grade-answer/handler.ts';

// Set up mock test environment
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock_service_role_key";
process.env.OPENROUTER_API_KEY = "mock_openrouter_api_key";

// ============================================================================
// PART 1: STATIC DDL VERIFICATION — MIGRATION 20261122180000_secure_user_answers_rls.sql
// ============================================================================

test('RLS DDL 1: Migration enforces RLS on public.user_answers', () => {
  const sql = fs.readFileSync('supabase/migrations/20261122180000_secure_user_answers_rls.sql', 'utf8');
  assert.equal(
    sql.includes('ALTER TABLE public.user_answers ENABLE ROW LEVEL SECURITY;'),
    true,
    'RLS must be explicitly enabled on user_answers'
  );
});

test('RLS DDL 2: Migration restricts UPDATE policy to own active attempts (completed_at IS NULL)', () => {
  const sql = fs.readFileSync('supabase/migrations/20261122180000_secure_user_answers_rls.sql', 'utf8');
  assert.equal(
    sql.includes('CREATE POLICY "Users can update own active answers"'),
    true,
    'Must define scoped UPDATE policy for own active answers'
  );
  assert.equal(
    sql.includes('quiz_attempts.completed_at IS NULL'),
    true,
    'UPDATE policy must prohibit modifications once attempt is completed'
  );
  assert.equal(
    sql.includes('quiz_attempts.user_id = auth.uid()'),
    true,
    'UPDATE policy must strictly enforce user ownership'
  );
});

test('RLS DDL 3: Migration creates immutability trigger protecting grading and claim fields', () => {
  const sql = fs.readFileSync('supabase/migrations/20261122180000_secure_user_answers_rls.sql', 'utf8');
  assert.equal(
    sql.includes('CREATE OR REPLACE FUNCTION public.check_user_answers_immutable_fields()'),
    true,
    'Trigger function must be defined'
  );
  assert.equal(
    sql.includes('OLD.ai_score IS DISTINCT FROM NEW.ai_score'),
    true,
    'Trigger must protect ai_score'
  );
  assert.equal(
    sql.includes('OLD.is_correct IS DISTINCT FROM NEW.is_correct'),
    true,
    'Trigger must protect is_correct'
  );
  assert.equal(
    sql.includes('OLD.grading_status IS DISTINCT FROM NEW.grading_status'),
    true,
    'Trigger must protect grading_status'
  );
  assert.equal(
    sql.includes('OLD.claim_token IS DISTINCT FROM NEW.claim_token'),
    true,
    'Trigger must protect claim_token'
  );
});

test('RLS DDL 4: Migration restricts column privileges for authenticated role to user inputs only', () => {
  const sql = fs.readFileSync('supabase/migrations/20261122180000_secure_user_answers_rls.sql', 'utf8');
  assert.equal(
    sql.includes('REVOKE UPDATE ON public.user_answers FROM authenticated;'),
    true,
    'Broad update permissions must be revoked'
  );
  assert.equal(
    sql.includes('GRANT UPDATE (selected_option_id, text_answer) ON public.user_answers TO authenticated;'),
    true,
    'Only user-input columns may be updated by authenticated role'
  );
});

// ============================================================================
// PART 2: POSTGRESQL RLS & TRIGGER BEHAVIORAL SIMULATION (STUDENT IMMUTABILITY)
// ============================================================================

/**
 * Simulates PostgreSQL RLS and trigger enforcement as defined in the migration.
 */
function simulateUserAnswersUpdate({
  user,
  attempt,
  existingAnswer,
  updates
}) {
  // 1. Column privilege check (PostgreSQL column grants)
  const allowedStudentColumns = new Set(['selected_option_id', 'text_answer']);
  if (user.role === 'authenticated') {
    for (const col of Object.keys(updates)) {
      if (!allowedStudentColumns.has(col)) {
        return {
          allowed: false,
          error: `permission denied for column ${col} of relation user_answers`
        };
      }
    }
  }

  // 2. RLS policy check ("Users can update own active answers")
  if (user.role === 'authenticated') {
    if (attempt.user_id !== user.id) {
      return { allowed: false, error: 'RLS check violation: user does not own attempt', rowsAffected: 0 };
    }
    if (attempt.completed_at !== null) {
      return { allowed: false, error: 'RLS check violation: attempt is already completed', rowsAffected: 0 };
    }
  }

  // 3. Trigger check (trg_protect_user_answers_grading_fields)
  if (user.role !== 'service_role' && !user.is_admin) {
    const protectedFields = [
      'ai_score', 'is_correct', 'grading_status', 'grading_method',
      'claim_token', 'claim_expires_at', 'ai_feedback', 'graded_at'
    ];
    for (const field of protectedFields) {
      if (field in updates && updates[field] !== existingAnswer[field]) {
        return {
          allowed: false,
          error: `Access denied: Students are not permitted to modify grading or claim lifecycle fields.`
        };
      }
    }
  }

  return { allowed: true, updatedRecord: { ...existingAnswer, ...updates }, rowsAffected: 1 };
}

test('SIMULATION 1: Student cannot update another student answer record', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_attacker', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_victim', completed_at: null },
    existingAnswer: { id: 101, attempt_id: 10, text_answer: 'My answer' },
    updates: { text_answer: 'Tampered answer' }
  });
  assert.equal(result.allowed, false);
  assert.match(result.error, /does not own attempt/i);
});

test('SIMULATION 2: Student cannot update answer after quiz attempt is completed (sealed)', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_1', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: '2026-11-23T10:00:00Z' },
    existingAnswer: { id: 101, attempt_id: 10, text_answer: 'My answer' },
    updates: { text_answer: 'New answer after submit' }
  });
  assert.equal(result.allowed, false);
  assert.match(result.error, /attempt is already completed/i);
});

test('SIMULATION 3: Student cannot manipulate ai_score directly via client update', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_1', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: null },
    existingAnswer: { id: 101, attempt_id: 10, ai_score: 0 },
    updates: { ai_score: 2 }
  });
  assert.equal(result.allowed, false);
  assert.match(result.error, /permission denied for column ai_score/i);
});

test('SIMULATION 4: Student cannot manipulate is_correct directly via client update', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_1', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: null },
    existingAnswer: { id: 101, attempt_id: 10, is_correct: false },
    updates: { is_correct: true }
  });
  assert.equal(result.allowed, false);
  assert.match(result.error, /permission denied for column is_correct/i);
});

test('SIMULATION 5: Student cannot manipulate grading_status directly via client update', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_1', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: null },
    existingAnswer: { id: 101, attempt_id: 10, grading_status: 'pending' },
    updates: { grading_status: 'graded' }
  });
  assert.equal(result.allowed, false);
  assert.match(result.error, /permission denied for column grading_status/i);
});

test('SIMULATION 6: Student cannot manipulate claim_token or claim_expires_at', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_1', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: null },
    existingAnswer: { id: 101, attempt_id: 10, claim_token: null },
    updates: { claim_token: '00000000-0000-0000-0000-000000000000' }
  });
  assert.equal(result.allowed, false);
  assert.match(result.error, /permission denied for column claim_token/i);
});

test('SIMULATION 7: Student CAN update permitted input columns (text_answer, selected_option_id) during active attempt', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'student_1', role: 'authenticated', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: null },
    existingAnswer: { id: 101, attempt_id: 10, text_answer: 'Draft 1', selected_option_id: null },
    updates: { text_answer: 'Draft 2', selected_option_id: 42 }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.updatedRecord.text_answer, 'Draft 2');
  assert.equal(result.updatedRecord.selected_option_id, 42);
});

test('SIMULATION 8: Service role key bypasses student restrictions to finalize authoritative grades', () => {
  const result = simulateUserAnswersUpdate({
    user: { id: 'edge_function', role: 'service_role', is_admin: false },
    attempt: { id: 10, user_id: 'student_1', completed_at: '2026-11-23T10:00:00Z' },
    existingAnswer: { id: 101, attempt_id: 10, ai_score: 0, is_correct: false, grading_status: 'in_progress' },
    updates: {
      ai_score: 2,
      is_correct: true,
      grading_status: 'graded',
      grading_method: 'deterministic_exact',
      claim_token: null,
      claim_expires_at: null
    }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.updatedRecord.ai_score, 2);
  assert.equal(result.updatedRecord.is_correct, true);
  assert.equal(result.updatedRecord.grading_status, 'graded');
});

// ============================================================================
// PART 3: EDGE FUNCTION SERVER-SIDE DETERMINISTIC EXACT-MATCH EVALUATION
// ============================================================================

test('EXACT MATCH SERVER 1: Exact match answer is evaluated and persisted server-side without calling OpenRouter', async () => {
  let openRouterCalled = false;
  let finalPatchBody = null;

  const answer = {
    id: 501,
    attempt_id: 40,
    question_id: 801,
    text_answer: "Theophilus",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending',
    claim_token: null,
    claim_expires_at: null
  };

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'student_user_1', role: 'authenticated' }), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/quiz_attempts')) {
      return new Response(JSON.stringify([{
        id: 40,
        user_id: 'student_user_1',
        completed_at: '2026-11-23T10:00:00Z',
        quiz_id: 1,
        is_graded: false
      }]), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/user_answers')) {
      if ((options.method || 'GET') === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        Object.assign(answer, body);
        if (body.grading_status === 'graded') {
          finalPatchBody = body;
        }
        return new Response(JSON.stringify([{ id: 501 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([answer]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (urlStr.includes('/rest/v1/questions')) {
      return new Response(JSON.stringify([{
        id: 801,
        quiz_id: 1,
        question_type: 'text',
        text_en: "To whom was the Gospel written?",
        ai_rubric: "Theophilus", // Canonical rubric matching "Theophilus"
        image_url: null
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('openrouter.ai')) {
      openRouterCalled = true;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":10,"feedback":"OK"}' } }] }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer student_token", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 40, answerId: 501 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.score, 10);
  assert.equal(data.method, 'deterministic_exact');
  assert.equal(data.provider, 'deterministic');
  assert.equal(openRouterCalled, false, 'OpenRouter must NOT be called for exact matches');

  // Verify server-side database mutation performed via service role
  assert.ok(finalPatchBody !== null, 'Server must finalize score in user_answers');
  assert.equal(finalPatchBody.ai_score, 2);
  assert.equal(finalPatchBody.is_correct, true);
  assert.equal(finalPatchBody.grading_status, 'graded');
  assert.equal(finalPatchBody.grading_method, 'deterministic_exact');
  assert.equal(finalPatchBody.claim_token, null);
  assert.equal(finalPatchBody.claim_expires_at, null);
});

test('EXACT MATCH SERVER 2: Subjective non-exact answer falls through to OpenRouter AI grading', async () => {
  let openRouterCalled = false;

  const answer = {
    id: 502,
    attempt_id: 40,
    question_id: 802,
    text_answer: "Zechariah was made speechless by Gabriel because of disbelief",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending',
    claim_token: null,
    claim_expires_at: null
  };

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'student_user_1', role: 'authenticated' }), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/quiz_attempts')) {
      return new Response(JSON.stringify([{
        id: 40,
        user_id: 'student_user_1',
        completed_at: '2026-11-23T10:00:00Z',
        quiz_id: 1,
        is_graded: false
      }]), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/user_answers')) {
      if ((options.method || 'GET') === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        Object.assign(answer, body);
        return new Response(JSON.stringify([{ id: 502 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([answer]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/rest/v1/questions')) {
      return new Response(JSON.stringify([{
        id: 802,
        quiz_id: 1,
        question_type: 'text',
        text_en: "What happened to Zechariah in the temple?",
        ai_rubric: "Zechariah Vision Mute", // Keyword rubric: must be evaluated semantically by AI!
        image_url: null
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/rest/v1/ai_provider_config')) {
      return new Response(JSON.stringify([{
        provider: 'openrouter',
        primary_model: 'google/gemini-2.0-flash-001',
        fallback_model: 'qwen/qwen-2.5-72b-instruct',
        enabled: true
      }]), { status: 200 });
    }
    if (urlStr.includes('openrouter.ai')) {
      openRouterCalled = true;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":9,"feedback":"Accurately describes Zechariah becoming mute."}' } }] }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer student_token", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 40, answerId: 502 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.score, 9);
  assert.equal(data.method, 'ai');
  assert.equal(openRouterCalled, true, 'Subjective concept rubric MUST invoke OpenRouter');
  assert.equal(answer.ai_score, 2);
  assert.equal(answer.grading_status, 'graded');
});
