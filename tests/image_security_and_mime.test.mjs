import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  validateImageUrl, 
  detectImageMimeType, 
  fetchImageSafely,
  handleGradeAnswer,
  MAX_IMAGE_SIZE_BYTES
} from '../supabase/functions/grade-answer/handler.ts';

// Standard test image payloads
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock_service_role_key";
process.env.OPENROUTER_API_KEY = "mock_openrouter_api_key";

const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]);
const VALID_JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]);
const VALID_GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const VALID_WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const HTML_BYTES = new TextEncoder().encode("<!DOCTYPE html><html><body>Error</body></html>");

// ============================================================================
// TASK 1: SSRF DEFENSE TESTS (validateImageUrl)
// ============================================================================

test('SSRF 1: Valid public HTTPS domain image URL is allowed', () => {
  const result = validateImageUrl('https://images.example.com/art.png');
  assert.equal(result.valid, true);
  assert.equal(result.url?.hostname, 'images.example.com');
});

test('SSRF 2: Valid Supabase storage HTTPS URL is allowed', () => {
  const result = validateImageUrl('https://xyzcompany.supabase.co/storage/v1/object/public/question-images/questions/art.png');
  assert.equal(result.valid, true);
  assert.equal(result.url?.hostname, 'xyzcompany.supabase.co');
});

test('SSRF 3: HTTP protocol is strictly rejected', () => {
  const result = validateImageUrl('http://images.example.com/art.png');
  assert.equal(result.valid, false);
  assert.match(result.error, /Only HTTPS is permitted/i);
});

test('SSRF 4: File, FTP, and Data protocols are rejected', () => {
  assert.equal(validateImageUrl('file:///etc/passwd').valid, false);
  assert.equal(validateImageUrl('ftp://example.com/art.png').valid, false);
  assert.equal(validateImageUrl('data:image/png;base64,abc').valid, false);
});

test('SSRF 5: Localhost and .localhost domains are rejected', () => {
  const res1 = validateImageUrl('https://localhost/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Prohibited internal\/local hostname/i);

  const res2 = validateImageUrl('https://sub.localhost/art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Prohibited internal\/local hostname/i);
});

test('SSRF 6: Loopback IPv4 addresses (127.0.0.0/8) are rejected in all notations', () => {
  // Standard dotted-decimal
  const res1 = validateImageUrl('https://127.0.0.1/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Loopback IP address rejected/i);

  // 127.1.2.3
  const res2 = validateImageUrl('https://127.1.2.3/art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Loopback IP address rejected/i);

  // Hex notation (normalizes to 127.0.0.1 via WHATWG URL parser)
  const res3 = validateImageUrl('https://0x7f.0.0.1/art.png');
  assert.equal(res3.valid, false);
  assert.match(res3.error, /Loopback IP address rejected/i);

  // Integer notation 2130706433 (127.0.0.1)
  const res4 = validateImageUrl('https://2130706433/art.png');
  assert.equal(res4.valid, false);
  assert.match(res4.error, /Loopback IP address rejected/i);
});

test('SSRF 7: IPv6 loopback [::1] is rejected', () => {
  const res = validateImageUrl('https://[::1]/art.png');
  assert.equal(res.valid, false);
  assert.match(res.error, /IPv6 loopback address rejected/i);
});

test('SSRF 8: Cloud metadata endpoints are strictly rejected', () => {
  // AWS / GCP / Azure 169.254.169.254
  const res1 = validateImageUrl('https://169.254.169.254/latest/meta-data/');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /cloud metadata IP address rejected/i);

  // GCP internal metadata domain
  const res2 = validateImageUrl('https://metadata.google.internal/computeMetadata/v1/');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Prohibited internal\/local hostname/i);

  // AWS instance-data
  const res3 = validateImageUrl('https://instance-data/latest/meta-data');
  assert.equal(res3.valid, false);
  assert.match(res3.error, /Prohibited internal\/local hostname/i);
});

test('SSRF 9: Private RFC 1918 IPv4 ranges are rejected', () => {
  // 10.0.0.0/8
  const res1 = validateImageUrl('https://10.0.0.1/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Private network IP address rejected \(10\.0\.0\.0\/8\)/i);

  // 172.16.0.0/12
  const res2 = validateImageUrl('https://172.16.0.1/art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Private network IP address rejected \(172\.16\.0\.0\/12\)/i);

  // 192.168.0.0/16
  const res3 = validateImageUrl('https://192.168.1.1/art.png');
  assert.equal(res3.valid, false);
  assert.match(res3.error, /Private network IP address rejected \(192\.168\.0\.0\/16\)/i);
});

test('SSRF 10: IPv6 private (ULA) and link-local ranges are rejected', () => {
  const res1 = validateImageUrl('https://[fc00::1]/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /IPv6 unique local address rejected/i);

  const res2 = validateImageUrl('https://[fe80::1]/art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /IPv6 link-local address rejected/i);
});

test('SSRF 11: URLs containing user credentials are rejected', () => {
  const res = validateImageUrl('https://admin:secret@images.example.com/art.png');
  assert.equal(res.valid, false);
  assert.match(res.error, /URLs containing user credentials are prohibited/i);
});

test('SSRF 12: Non-standard ports are rejected', () => {
  const res = validateImageUrl('https://images.example.com:8443/art.png');
  assert.equal(res.valid, false);
  assert.match(res.error, /Non-standard port "8443" is prohibited/i);
});

test('SSRF 13: Unqualified hostnames (no dots) are rejected', () => {
  const res = validateImageUrl('https://internalservice/art.png');
  assert.equal(res.valid, false);
  assert.match(res.error, /Unqualified hostname/i);
});

test('SSRF 14: Dynamic DNS nip.io hostnames (169.254.169.254.nip.io and 127.0.0.1.nip.io) are strictly rejected', () => {
  const res1 = validateImageUrl('https://169.254.169.254.nip.io/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Dynamic DNS service rejected/i);

  const res2 = validateImageUrl('https://127.0.0.1.nip.io/art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Dynamic DNS service rejected/i);

  const res3 = validateImageUrl('https://sub.10.0.0.1.nip.io/art.png');
  assert.equal(res3.valid, false);
  assert.match(res3.error, /Dynamic DNS service rejected/i);
});

test('SSRF 15: Dynamic DNS sslip.io, xip.io, and localtest.me hostnames are strictly rejected', () => {
  const res1 = validateImageUrl('https://127.0.0.1.sslip.io/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Dynamic DNS service rejected/i);

  const res2 = validateImageUrl('https://10.0.0.1.xip.io/art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Dynamic DNS service rejected/i);

  const res3 = validateImageUrl('https://localtest.me/art.png');
  assert.equal(res3.valid, false);
  assert.match(res3.error, /Dynamic DNS service rejected/i);
});

test('SSRF 16: Dynamic DNS case variations (NIP.IO) and trailing dot (nip.io.) are strictly rejected', () => {
  const res1 = validateImageUrl('https://127.0.0.1.NIP.IO/art.png');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Dynamic DNS service rejected/i);

  const res2 = validateImageUrl('https://127.0.0.1.nip.io./art.png');
  assert.equal(res2.valid, false);
  assert.match(res2.error, /Dynamic DNS service rejected/i);
});

test('SSRF 17: Benign domains containing similar substrings (notnip.io) are not falsely rejected', () => {
  const res = validateImageUrl('https://notnip.io/art.png');
  assert.equal(res.valid, true);
});

// ============================================================================
// TASK 2 & 3: MIME VALIDATION & STREAMING SIZE LIMIT (fetchImageSafely)
// ============================================================================

test('MIME 1: detectImageMimeType correctly identifies PNG, JPEG, GIF, WEBP magic numbers', () => {
  assert.equal(detectImageMimeType(VALID_PNG_BYTES), 'image/png');
  assert.equal(detectImageMimeType(VALID_JPEG_BYTES), 'image/jpeg');
  assert.equal(detectImageMimeType(VALID_GIF_BYTES), 'image/gif');
  assert.equal(detectImageMimeType(VALID_WEBP_BYTES), 'image/webp');
  assert.equal(detectImageMimeType(HTML_BYTES), null);
  assert.equal(detectImageMimeType(new Uint8Array([1, 2, 3])), null);
});

test('IMAGE FETCH 1: Valid PNG download succeeds and returns verified MIME and base64', async () => {
  const mockFetch = async () => new Response(VALID_PNG_BYTES, {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(VALID_PNG_BYTES.length) }
  });

  const result = await fetchImageSafely('https://images.example.com/valid.png', mockFetch);
  assert.equal(result.mimeType, 'image/png');
  assert.ok(result.base64.length > 0);
});

test('IMAGE FETCH 2: Valid JPEG download succeeds and returns verified MIME and base64', async () => {
  const mockFetch = async () => new Response(VALID_JPEG_BYTES, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(VALID_JPEG_BYTES.length) }
  });

  const result = await fetchImageSafely('https://images.example.com/valid.jpg', mockFetch);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.ok(result.base64.length > 0);
});

test('IMAGE FETCH 3: HTML response is rejected even if HTTP status is 200', async () => {
  const mockFetch = async () => new Response(HTML_BYTES, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/page.html', mockFetch),
    /Rejected non-image Content-Type: text\/html/i
  );
});

test('IMAGE FETCH 4: Unsupported MIME type is rejected', async () => {
  const mockFetch = async () => new Response(new Uint8Array([0, 1, 2, 3, 4, 5]), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' }
  });

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/doc.pdf', mockFetch),
    /Unsupported image MIME type: application\/pdf/i
  );
});

test('IMAGE FETCH 5: MIME mismatch (header declared image/png but body is JPEG) is rejected', async () => {
  const mockFetch = async () => new Response(VALID_JPEG_BYTES, {
    status: 200,
    headers: { 'Content-Type': 'image/png' } // Declared PNG, but actual bytes are JPEG!
  });

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/mismatch.png', mockFetch),
    /MIME type mismatch/i
  );
});

test('IMAGE FETCH 6: Oversized Content-Length (>10MB) is rejected before reading body', async () => {
  const mockFetch = async () => new Response(new Uint8Array(10), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '15000000' } // 15MB
  });

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/huge.jpg', mockFetch),
    /Image size exceeds 10MB limit \(Content-Length: 15000000 bytes\)/i
  );
});

test('IMAGE FETCH 7: Oversized streamed payload (without Content-Length) aborts stream when exceeding 10MB', async () => {
  // Stream that yields 11 chunks of 1MB each
  const oneMbChunk = new Uint8Array(1024 * 1024);
  let chunkCount = 0;
  let streamCancelled = false;

  const stream = new ReadableStream({
    async pull(controller) {
      if (chunkCount < 11) {
        chunkCount++;
        controller.enqueue(oneMbChunk);
      } else {
        controller.close();
      }
    },
    cancel(reason) {
      streamCancelled = true;
    }
  });

  const mockFetch = async () => new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg' } // Missing Content-Length header!
  });

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/stream-huge.jpg', mockFetch),
    /Image payload exceeded 10MB limit/i
  );

  assert.equal(streamCancelled, true, 'Underlying stream reader must be cancelled to release resources');
});

test('IMAGE FETCH 8: Redirect to SSRF destination (metadata endpoint) is rejected', async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (callCount === 1) {
      // Return 302 redirecting to AWS cloud metadata!
      return new Response(null, {
        status: 302,
        headers: { 'Location': 'https://169.254.169.254/latest/meta-data/' }
      });
    }
    return new Response(VALID_PNG_BYTES, { status: 200 });
  };

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/redirect-to-metadata', mockFetch),
    /SSRF defense rejected redirect destination: Link-local \/ cloud metadata IP address rejected/i
  );

  assert.equal(callCount, 1, 'Must NOT follow redirect to prohibited destination');
});

test('IMAGE FETCH 9: Valid redirect to approved domain succeeds', async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (url === 'https://images.example.com/start') {
      return new Response(null, {
        status: 301,
        headers: { 'Location': 'https://cdn.example.com/final.png' }
      });
    }
    return new Response(VALID_PNG_BYTES, {
      status: 200,
      headers: { 'Content-Type': 'image/png' }
    });
  };

  const result = await fetchImageSafely('https://images.example.com/start', mockFetch);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(callCount, 2);
});

test('IMAGE FETCH 10: Redirect to dynamic DNS domain (169.254.169.254.nip.io) is strictly rejected', async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (callCount === 1) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': 'https://169.254.169.254.nip.io/malicious.png' }
      });
    }
    return new Response(VALID_PNG_BYTES, { status: 200 });
  };

  await assert.rejects(
    () => fetchImageSafely('https://images.example.com/redirect-to-nip', mockFetch),
    /SSRF defense rejected redirect destination: Dynamic DNS service rejected/i
  );

  assert.equal(callCount, 1, 'Must NOT follow redirect to dynamic DNS destination');
});

// ============================================================================
// INTEGRATION: END-TO-END EDGE FUNCTION SSRF & FAILURE SAFETY (handleGradeAnswer)
// ============================================================================

test('INTEGRATION 1: Picture question with SSRF image URL (169.254.169.254) releases claim and returns 502 without calling OpenRouter', async () => {
  let openRouterCalled = false;
  const answer = {
    id: 301,
    attempt_id: 20,
    question_id: 950,
    text_answer: "Gabriel",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'usr_1', role: 'user' }), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/quiz_attempts')) {
      return new Response(JSON.stringify([{ id: 20, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false }]), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/user_answers')) {
      if ((options.method || 'GET') === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        Object.assign(answer, body);
        return new Response(JSON.stringify([{ id: 301 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([answer]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/rest/v1/questions')) {
      return new Response(JSON.stringify([{
        id: 950,
        quiz_id: 1,
        question_type: 'picture',
        text_en: "Who is pictured?",
        ai_rubric: "Gabriel",
        image_url: "https://169.254.169.254/latest/meta-data/" // SSRF ATTACK!
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
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":10,"feedback":"OK"}' } }] }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 20, answerId: 301 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.category, 'provider_error');
  assert.match(data.error, /SSRF defense rejected image URL/i);
  assert.equal(openRouterCalled, false, 'OpenRouter must NEVER be called when image URL fails SSRF check');
  assert.equal(answer.grading_status, 'failed', 'Claim must be released to failed');
  assert.equal(answer.claim_token, null, 'Claim token must be cleared');
});

test('INTEGRATION 2: Picture question with HTML response releases claim and returns 502 without calling OpenRouter', async () => {
  let openRouterCalled = false;
  const answer = {
    id: 302,
    attempt_id: 20,
    question_id: 951,
    text_answer: "Gabriel",
    ai_score: 0,
    is_correct: false,
    grading_status: 'pending'
  };

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr === 'https://images.example.com/not-an-image.html') {
      return new Response(HTML_BYTES, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'usr_1', role: 'user' }), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/quiz_attempts')) {
      return new Response(JSON.stringify([{ id: 20, user_id: 'usr_1', completed_at: '2026-11-22T10:00:00Z', quiz_id: 1, is_graded: false }]), { status: 200 });
    }
    if (urlStr.includes('/rest/v1/user_answers')) {
      if ((options.method || 'GET') === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        Object.assign(answer, body);
        return new Response(JSON.stringify([{ id: 302 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([answer]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/rest/v1/questions')) {
      return new Response(JSON.stringify([{
        id: 951,
        quiz_id: 1,
        question_type: 'picture',
        text_en: "Who is pictured?",
        ai_rubric: "Gabriel",
        image_url: "https://images.example.com/not-an-image.html" // Returns HTML!
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
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":10,"feedback":"OK"}' } }] }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const req = new Request("https://mock.supabase.co/functions/v1/grade-answer", {
    method: "POST",
    headers: { "Authorization": "Bearer token1", "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId: 20, answerId: 302 })
  });

  const res = await handleGradeAnswer(req, mockFetch, 120_000);
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.match(data.error, /Rejected non-image Content-Type: text\/html/i);
  assert.equal(openRouterCalled, false);
  assert.equal(answer.grading_status, 'failed');
  assert.equal(answer.claim_token, null);
});
