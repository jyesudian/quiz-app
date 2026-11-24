import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGradeAnswer, isModelVisionCapable } from '../supabase/functions/grade-answer/handler.ts';

/**
 * Real Edge Function Handler Runtime Tests (Direct Execution of handler.ts in Node.js)
 * Executes the ACTUAL production Edge Function code with mock HTTP endpoints.
 * Emulates realistic PostgREST query parsing, URL parameter decoding, and grammar validation.
 * Covers all 14 concurrency, stale claim, lease recovery, and lifecycle scenarios (Scenarios A through N).
 */

function createMockFetch({
  users = {},
  attempts = {},
  answers = {},
  questions = {},
  aiConfig = {
    provider: 'openrouter',
    primary_model: 'google/gemini-2.0-flash-001',
    fallback_model: 'qwen/qwen-2.5-72b-instruct',
    enabled: true
  },
  aiConfigState = 'ok', // 'ok' | 'empty' | 'db_error'
  schemaHasClaimRecovery = true, // If false, simulate missing claim_token / claim_expires_at columns
  openRouterMock = { status: 200, score: 9.0, feedback: "Biblically accurate." },
  onOpenRouterCall = null,
  onPatchAnswer = null,
  simulateDbFinalizeFailure = false,
  imageFetchMock = null // Custom handler or delay/error for images
}) {
  let openRouterCallCount = 0;

  return async function mockFetch(url, options = {}) {
    const urlStr = String(url);
    const method = (options.method || 'GET').toUpperCase();

    // 0. Image downloads
    if (urlStr.startsWith('https://images.example.com/') || urlStr.startsWith('http://images.example.com/')) {
      if (imageFetchMock) {
        return imageFetchMock(urlStr, options);
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      });
    }

    // 1. Supabase Auth endpoint
    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = options.headers?.['Authorization'] || options.headers?.['authorization'];
      const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
      const user = users[token];
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
      }
      return new Response(JSON.stringify(user), { status: 200 });
    }

    // 2. ai_provider_config endpoint
    if (urlStr.includes('/rest/v1/ai_provider_config')) {
      if (aiConfigState === 'db_error') {
        return new Response("DB connection failed", { status: 500 });
      }
      if (aiConfigState === 'empty') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([aiConfig]), { status: 200 });
    }

    // 3. quiz_attempts endpoint
    if (urlStr.includes('/rest/v1/quiz_attempts')) {
      const parsedUrl = new URL(urlStr);
      const idParam = parsedUrl.searchParams.get('id');
      const id = idParam ? parseInt(idParam.replace(/^eq\./, '')) : null;
      const attempt = attempts[id];
      if (!attempt) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([attempt]), { status: 200 });
    }

    // 4. profiles endpoint (for admin checks)
    if (urlStr.includes('/rest/v1/profiles')) {
      const parsedUrl = new URL(urlStr);
      const idParam = parsedUrl.searchParams.get('id');
      const uid = idParam ? idParam.replace(/^eq\./, '') : null;
      const isAdmin = Object.values(users).some(u => u.id === uid && u.role === 'admin');
      if (isAdmin) {
        return new Response(JSON.stringify([{ id: uid }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }

    // 5. user_answers endpoint
    if (urlStr.includes('/rest/v1/user_answers')) {
      const parsedUrl = new URL(urlStr);
      const idParam = parsedUrl.searchParams.get('id');
      const id = idParam ? parseInt(idParam.replace(/^eq\./, '')) : null;
      const answer = answers[id];

      // Missing schema check (Fail-Closed verification)
      if (!schemaHasClaimRecovery) {
        const select = parsedUrl.searchParams.get('select') || '';
        if (select.includes('claim_token') || select.includes('claim_expires_at')) {
          return new Response(
            JSON.stringify({ code: "PGRST204", message: "Could not find the 'claim_token' column of 'user_answers' in the schema cache" }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      if (method === 'PATCH') {
        if (!schemaHasClaimRecovery) {
          const body = options.body ? JSON.parse(options.body) : {};
          if (body.claim_token !== undefined || body.claim_expires_at !== undefined) {
            return new Response(
              JSON.stringify({ code: "PGRST204", message: "Could not find the 'claim_token' column of 'user_answers' in the schema cache" }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        if (simulateDbFinalizeFailure && parsedUrl.searchParams.has('claim_token')) {
          return new Response("DB write error", { status: 500 });
        }

        const body = options.body ? JSON.parse(options.body) : {};
        if (onPatchAnswer) {
          onPatchAnswer(id, body, urlStr);
        }

        // --- REALISTIC POSTGREST PARSER EMULATION ---
        const orParam = parsedUrl.searchParams.get('or');
        if (orParam) {
          // Check for unquoted colons in claim_expires_at.lt. filter:
          // PostgREST grammar requires values with colons to be enclosed in double quotes.
          const ltMatch = orParam.match(/claim_expires_at\.lt\.([^,)]+)/);
          if (ltMatch) {
            const rawVal = ltMatch[1];
            if (rawVal.includes(':') && (!rawVal.startsWith('"') || !rawVal.endsWith('"'))) {
              return new Response(
                JSON.stringify({
                  code: "PGRST100",
                  details: "unexpected ':'",
                  message: "failed to parse filter: colons in timestamps require double quotes inside or/and groups"
                }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
              );
            }
          }

          // Evaluate claim acquisition conditions:
          let leaseExpiryThreshold = new Date();
          if (ltMatch) {
            const cleanVal = ltMatch[1].replace(/^"|"$/g, '');
            leaseExpiryThreshold = new Date(cleanVal);
          }

          const isPendingOrFailed = !answer || !answer.grading_status ||
            answer.grading_status === 'pending' ||
            answer.grading_status === 'failed' ||
            answer.grading_status === 'retry_pending';

          const isExpiredInProgress = answer && answer.grading_status === 'in_progress' &&
            (!answer.claim_expires_at || new Date(answer.claim_expires_at) < leaseExpiryThreshold);

          if (answer && (isPendingOrFailed || isExpiredInProgress)) {
            Object.assign(answer, body);
            return new Response(JSON.stringify([{ id: answer.id }]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            // Already claimed with active, unexpired lease -> 0 rows claimed (concurrency rejection)
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        // Ownership-Fenced Finalization or Release check:
        const claimTokenFilter = parsedUrl.searchParams.get('claim_token');
        if (claimTokenFilter) {
          const reqToken = claimTokenFilter.replace(/^eq\./, '');
          const statusFilter = parsedUrl.searchParams.get('grading_status')?.replace(/^eq\./, '');

          const matchesToken = answer && answer.claim_token === reqToken;
          const matchesStatus = !statusFilter || (answer && answer.grading_status === statusFilter);

          if (matchesToken && matchesStatus) {
            Object.assign(answer, body);
            return new Response(JSON.stringify([{ id: answer.id }]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            // Stale claim: Token mismatch or no longer in_progress -> 0 rows updated
            return new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        if (answer) {
          Object.assign(answer, body);
          return new Response(JSON.stringify([answer]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // GET
      if (!answer) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([answer]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 6. questions endpoint
    if (urlStr.includes('/rest/v1/questions')) {
      const parsedUrl = new URL(urlStr);
      const idParam = parsedUrl.searchParams.get('id');
      const id = idParam ? parseInt(idParam.replace(/^eq\./, '')) : null;
      const question = questions[id];
      if (!question) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([question]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 7. OpenRouter completions endpoint
    if (urlStr.includes('openrouter.ai/api/v1/chat/completions')) {
      openRouterCallCount++;
      if (onOpenRouterCall) {
        await onOpenRouterCall(options);
      }
      if (openRouterMock.status && openRouterMock.status !== 200) {
        return new Response(JSON.stringify({ error: { message: "OpenRouter mock error" } }), { status: openRouterMock.status });
      }
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: openRouterMock.score,
                feedback: openRouterMock.feedback
              })
            }
          }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response("Not found", { status: 404 });
  };
}

// Setup environment variables for handler testing
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock_service_role_key";
process.env.OPENROUTER_API_KEY = "mock_openrouter_api_key";

// ---------------------------------------------------------------------------
// SCENARIO A: Normal grading flow
// ---------------------------------------------------------------------------
test('SCENARIO A: Normal grading flow (pending -> in_progress claim -> OpenRouter -> graded with cleared tokens)', async () => {
  let openRouterCalls = 0;
  const answer = {
    id: 201,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah became mute after seeing the angel",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 201: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "What happened to Zechariah?", ai_rubric: "Zechariah Vision Mute" } },
    openRouterMock: { status: 200, score: 9.5, feedback: "Accurate biblical answer." },
    onOpenRouterCall: () => { openRouterCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 201 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.score, 9.5);
  assert.equal(openRouterCalls, 1);

  // Verify DB record after finalization
  assert.equal(answer.grading_status, 'graded');
  assert.equal(answer.ai_score, 2);
  assert.equal(answer.is_correct, true);
  assert.equal(answer.claim_token, null, 'claim_token must be cleared upon successful finalization');
  assert.equal(answer.claim_expires_at, null, 'claim_expires_at must be cleared upon successful finalization');
});

// ---------------------------------------------------------------------------
// SCENARIO B: Stale claim recovery
// ---------------------------------------------------------------------------
test('SCENARIO B: Stale in_progress claim whose lease expired is reclaimed and successfully graded', async () => {
  let openRouterCalls = 0;
  const expiredAnswer = {
    id: 202,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah became mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'in_progress',
    claim_token: 'old-crashed-worker-uuid',
    claim_expires_at: new Date(Date.now() - 60_000).toISOString() // Expired 1 minute ago
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 202: expiredAnswer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Zechariah Vision Mute" } },
    openRouterMock: { status: 200, score: 8.5, feedback: "Good answer." },
    onOpenRouterCall: () => { openRouterCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 202 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 200);
  assert.equal(openRouterCalls, 1, 'Expired in_progress claim must be reclaimed and evaluated');
  assert.equal(expiredAnswer.grading_status, 'graded');
  assert.equal(expiredAnswer.ai_score, 2);
  assert.equal(expiredAnswer.claim_token, null);
});

// ---------------------------------------------------------------------------
// SCENARIO C: Active lease protection
// ---------------------------------------------------------------------------
test('SCENARIO C: Active unexpired lease returns HTTP 409 grading_in_progress without calling OpenRouter', async () => {
  let openRouterCalls = 0;
  const answer = {
    id: 203,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah became mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'in_progress',
    claim_token: 'worker-1-uuid',
    claim_expires_at: new Date(Date.now() + 60_000).toISOString() // Expires in 60s
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 203: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    onOpenRouterCall: () => { openRouterCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 203 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.category, 'grading_in_progress');
  assert.equal(openRouterCalls, 0, 'Must NOT invoke OpenRouter while active unexpired lease is held');
});

// ---------------------------------------------------------------------------
// SCENARIO D: Fencing token protection
// ---------------------------------------------------------------------------
test('SCENARIO D: Fencing token rejects stale worker finalization (Request A expires -> B reclaims -> A rejected 409 stale_claim)', async () => {
  const sharedAnswer = {
    id: 204,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending',
    claim_token: null,
    claim_expires_at: null
  };

  let stallRequestA = true;
  let releaseRequestA;
  const stallPromise = new Promise(resolve => { releaseRequestA = resolve; });

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 204: sharedAnswer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Zechariah Vision Mute" } },
    openRouterMock: { status: 200, score: 9.0, feedback: "Evaluation from Request B." },
    onOpenRouterCall: async () => {
      if (stallRequestA) {
        stallRequestA = false;
        await stallPromise;
      }
    }
  });

  const makeReq = () => new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 204 })
  });

  // STEP 1: Request A acquires claim with a 10ms lease and enters stalled OpenRouter call
  const resA_promise = handleGradeAnswer(makeReq(), mockFetch, 10);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(sharedAnswer.grading_status, 'in_progress');

  // STEP 2: Wait for Request A's lease to expire
  await new Promise(r => setTimeout(r, 15));

  // STEP 3: Request B arrives and reclaims the row with its own lease
  const resB = await handleGradeAnswer(makeReq(), mockFetch, 120_000);
  assert.equal(resB.status, 200);

  // Request B has finalized successfully
  assert.equal(sharedAnswer.grading_status, 'graded');
  assert.equal(sharedAnswer.ai_score, 2);
  assert.equal(sharedAnswer.ai_feedback, "Evaluation from Request B.");

  // STEP 4: Release Request A so it attempts its stale finalization
  releaseRequestA();
  const resA = await resA_promise;

  // STEP 5: Request A was rejected because its claim token was preempted
  assert.equal(resA.status, 409);
  const dataA = await resA.json();
  assert.equal(dataA.category, 'stale_claim');

  // Request B's data was NOT overwritten
  assert.equal(sharedAnswer.ai_feedback, "Evaluation from Request B.");
});

// ---------------------------------------------------------------------------
// SCENARIO E: Failure release
// ---------------------------------------------------------------------------
test('SCENARIO E: Provider failure after claim acquisition safely releases claim to failed with cleared tokens', async () => {
  const answer = {
    id: 205,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah became mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 205: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    openRouterMock: { status: 503 }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 205 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 502);
  assert.equal(answer.grading_status, 'failed', 'Must release claim to failed status');
  assert.equal(answer.claim_token, null, 'Must clear claim token on failure release');
  assert.equal(answer.claim_expires_at, null, 'Must clear claim expires_at on failure release');
});

// ---------------------------------------------------------------------------
// SCENARIO F: Missing schema fail-closed
// ---------------------------------------------------------------------------
test('SCENARIO F: Missing schema columns fails closed with HTTP 500 configuration_error (NO un-fenced fallback)', async () => {
  let openRouterCalls = 0;
  const answer = {
    id: 206,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 206: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    schemaHasClaimRecovery: false, // Simulates database missing claim_token/claim_expires_at
    onOpenRouterCall: () => { openRouterCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 206 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 500);
  const data = await res.json();
  assert.equal(data.category, 'configuration_error');
  assert.match(data.error, /missing required AI grading claim recovery columns/i);
  assert.equal(openRouterCalls, 0, 'Must NOT invoke OpenRouter when schema is missing columns');
  assert.notEqual(answer.grading_status, 'graded', 'Must NOT grade when schema is missing');
});

// ---------------------------------------------------------------------------
// SCENARIO G: Invalid PostgREST filter rejection
// ---------------------------------------------------------------------------
test('SCENARIO G: PostgREST mock rejects unquoted colons with HTTP 400 PGRST100; handler uses valid double-quoted syntax', async () => {
  // Direct test of the mock's PostgREST grammar validator
  const mockFetch = createMockFetch({});
  
  // Unquoted colons: Must fail with PGRST100
  const unquotedUrl = "https://mock.supabase.co/rest/v1/user_answers?id=eq.1&or=(grading_status.eq.in_progress,claim_expires_at.lt.2026-11-23T06:21:15.000Z)";
  const resBad = await mockFetch(unquotedUrl, { method: "PATCH", body: JSON.stringify({ grading_status: 'in_progress' }) });
  assert.equal(resBad.status, 400);
  const badData = await resBad.json();
  assert.equal(badData.code, "PGRST100");

  // Valid double-quoted colons: Must pass grammar check
  const quotedUrl = `https://mock.supabase.co/rest/v1/user_answers?id=eq.1&or=${encodeURIComponent('(grading_status.eq.in_progress,claim_expires_at.lt."2026-11-23T06:21:15.000Z")')}`;
  const resGood = await mockFetch(quotedUrl, { method: "PATCH", body: JSON.stringify({ grading_status: 'in_progress' }) });
  assert.notEqual(resGood.status, 400);
});

// ---------------------------------------------------------------------------
// SCENARIO H: Vision model check
// ---------------------------------------------------------------------------
test('SCENARIO H: Picture question with text-only fallback fails with 502 and releases claim to failed', async () => {
  const answer = {
    id: 208,
    attempt_id: 10,
    question_id: 902,
    text_answer: "The angel Gabriel appearing",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 208: answer },
    questions: { 902: { id: 902, quiz_id: 1, question_type: 'picture', text_en: "Identify person", ai_rubric: "Gabriel", image_url: "https://images.example.com/art.png" } },
    aiConfig: {
      provider: 'openrouter',
      primary_model: 'google/gemini-2.0-flash-001',
      fallback_model: 'meta-llama/llama-3-70b-instruct', // TEXT-ONLY MODEL!
      enabled: true
    },
    openRouterMock: { status: 503 } // Primary fails
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 208 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.match(data.error, /does not support image evaluation/i);
  assert.equal(answer.grading_status, 'failed', 'Claim must be released to failed');
  assert.equal(answer.claim_token, null);
});

// ---------------------------------------------------------------------------
// SCENARIO I: Multimodal image download timeout & abort
// ---------------------------------------------------------------------------
test('SCENARIO I: Multimodal image download failure/timeout releases claim to failed and returns 502/504', async () => {
  const answer = {
    id: 209,
    attempt_id: 10,
    question_id: 903,
    text_answer: "The angel Gabriel appearing",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  // Image fetch mock simulating timeout (AbortError)
  const imageFetchMock = async (_url, options) => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 209: answer },
    questions: { 903: { id: 903, quiz_id: 1, question_type: 'picture', text_en: "Identify person", ai_rubric: "Gabriel", image_url: "https://images.example.com/hanging-image.png" } },
    imageFetchMock
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 209 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 504);
  const data = await res.json();
  assert.equal(data.category, 'timeout');
  assert.equal(answer.grading_status, 'failed', 'Claim must be released to failed upon image download timeout');
  assert.equal(answer.claim_token, null);
});

// ---------------------------------------------------------------------------
// SCENARIO J: Zero-score idempotency
// ---------------------------------------------------------------------------
test('SCENARIO J: Zero-score answer is finalized as status=graded with ai_score=0 and cached permanently', async () => {
  let openRouterCalls = 0;
  const answer = {
    id: 210,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Completely wrong person Pontius Pilate",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 210: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Zechariah" } },
    openRouterMock: { status: 200, score: 0.0, feedback: "Incorrect person." },
    onOpenRouterCall: () => { openRouterCalls++; }
  });

  const makeReq = () => new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 210 })
  });

  // Call 1: Evaluates and finalizes zero score
  const res1 = await handleGradeAnswer(makeReq(), mockFetch, 120_000);
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.score, 0);
  assert.equal(openRouterCalls, 1);
  assert.equal(answer.grading_status, 'graded');
  assert.equal(answer.ai_score, 0);

  // Call 2: Returns cached zero without invoking OpenRouter
  const res2 = await handleGradeAnswer(makeReq(), mockFetch, 120_000);
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.score, 0);
  assert.equal(data2.model, 'cached');
  assert.equal(openRouterCalls, 1, 'Must NOT invoke OpenRouter again for cached zero');
});

// ---------------------------------------------------------------------------
// SCENARIO K: Finalized attempt protection
// ---------------------------------------------------------------------------
test('SCENARIO K: Finalized attempt (is_graded=true) returns cached score without claim acquisition', async () => {
  let patchCalls = 0;
  const answer = {
    id: 211,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Some answer",
    ai_score: 2,
    is_correct: true,
    grading_status: 'graded'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: true } }, // Finalized!
    answers: { 211: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    onPatchAnswer: () => { patchCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 211 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.model, 'cached');
  assert.equal(patchCalls, 0, 'Must NOT mutate database for finalized attempt');
});

// ---------------------------------------------------------------------------
// SCENARIO L: Blank answer fast path
// ---------------------------------------------------------------------------
test('SCENARIO L: Blank answer evaluates to score 0 with method=system without OpenRouter call', async () => {
  let openRouterCalls = 0;
  const answer = {
    id: 212,
    attempt_id: 10,
    question_id: 901,
    text_answer: "   \n\t   ",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 212: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    onOpenRouterCall: () => { openRouterCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 212 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.score, 0);
  assert.equal(data.method, 'system');
  assert.equal(openRouterCalls, 0, 'Blank answer must NOT invoke OpenRouter');
  assert.equal(answer.grading_status, 'graded');
});

// ---------------------------------------------------------------------------
// SCENARIO M: AI disabled fail-closed
// ---------------------------------------------------------------------------
test('SCENARIO M: AI disabled configuration releases claim to failed and returns 503 service_disabled', async () => {
  const answer = {
    id: 213,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: { 'token_usr1': { id: 'usr_1', role: 'user' } },
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 213: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    aiConfig: { provider: 'openrouter', primary_model: 'primary', fallback_model: 'fallback', enabled: false } // Disabled!
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token_usr1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 213 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.category, 'service_disabled');
  assert.equal(answer.grading_status, 'failed', 'Claim must be released to failed');
  assert.equal(answer.claim_token, null);
});

// ---------------------------------------------------------------------------
// SCENARIO N: Unauthenticated caller
// ---------------------------------------------------------------------------
test('SCENARIO N: Unauthenticated request returns 401 unauthorized with zero database mutations', async () => {
  let patchCalls = 0;
  const answer = {
    id: 214,
    attempt_id: 10,
    question_id: 901,
    text_answer: "Zechariah mute",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = createMockFetch({
    users: {}, // No valid tokens!
    attempts: { 10: { id: 10, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false } },
    answers: { 214: answer },
    questions: { 901: { id: 901, quiz_id: 1, question_type: 'text', text_en: "Question", ai_rubric: "Rubric" } },
    onPatchAnswer: () => { patchCalls++; }
  });

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer invalid_token", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 10, answerId: 214 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.category, 'unauthorized');
  assert.equal(patchCalls, 0, 'Unauthenticated request must never mutate database');
});
