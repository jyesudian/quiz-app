// supabase/functions/grade-answer/handler.ts
// Pure standard Web API handler compatible with both Deno runtime and Node.js v22+

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export interface GradeAnswerRequest {
  attemptId: number;
  answerId: number;
  questionId?: number;
  studentAnswer?: string;
  aiRubric?: string;
  questionEn?: string;
  imageUrl?: string | null;
}

export interface GradeAnswerSuccessResponse {
  score: number;
  feedback: string;
  model: string;
  method: 'ai' | 'system' | 'deterministic_exact';
  gradedAt: string;
  provider: 'openrouter' | 'deterministic';
  attemptedFallback: boolean;
  latencyMs: number;
}

export interface GradeAnswerErrorResponse {
  error: string;
  category: 
    | 'unauthorized' 
    | 'forbidden' 
    | 'missing_fields' 
    | 'missing_env_key' 
    | 'service_disabled' 
    | 'configuration_error' 
    | 'invalid_attempt_state' 
    | 'invalid_answer' 
    | 'invalid_question' 
    | 'grading_in_progress'
    | 'stale_claim'
    | 'not_found' 
    | 'provider_error' 
    | 'timeout' 
    | 'rate_limit' 
    | 'empty_response' 
    | 'parse_error' 
    | 'schema_validation_error' 
    | 'internal_error';
  status?: number;
  primaryError?: string;
  fallbackError?: string;
  modelAttempted?: string;
}

export type AiConfigState = 
  | 'explicitly_enabled'
  | 'explicitly_disabled'
  | 'not_configured'
  | 'db_retrieval_failure'
  | 'invalid_configuration';

export interface AiProviderConfig {
  provider: string;
  primary_model: string;
  fallback_model: string;
  enabled: boolean;
  state: AiConfigState;
}

interface GlobalEnvScope {
  Deno?: { env: { get: (k: string) => string | undefined } };
  process?: { env: Record<string, string | undefined> };
}

/**
 * Portable environment variable getter.
 */
export function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as GlobalEnvScope;
  if (g.Deno?.env?.get) {
    return g.Deno.env.get(key);
  }
  if (g.process?.env) {
    return g.process.env[key];
  }
  return undefined;
}

/**
 * Safely releases an in_progress claim back to 'failed' status only if the caller still owns the claim.
 * Clears claim_token and claim_expires_at atomically.
 */
export async function releaseClaimFenced(
  supabaseUrl: string,
  serviceRoleKey: string,
  answerId: number,
  claimToken: string,
  customFetch: typeof fetch = fetch
): Promise<void> {
  try {
    await customFetch(
      `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&claim_token=eq.${claimToken}&grading_status=eq.in_progress`,
      {
        method: 'PATCH',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grading_status: 'failed',
          claim_token: null,
          claim_expires_at: null
        })
      }
    );
  } catch (err) {
    console.warn(`[grade-answer] Fenced claim release warning for answer ${answerId}:`, err);
  }
}

/**
 * Checks whether a given model slug supports multimodal vision input.
 */
export function isModelVisionCapable(modelName: string): boolean {
  const visionPatterns = [
    /gemini/i,
    /gpt-4o/i,
    /gpt-4-vision/i,
    /claude-3/i,
    /qwen.*vl/i,
    /glm.*flash/i
  ];
  return visionPatterns.some(pattern => pattern.test(modelName));
}

/**
 * Checks whether an IPv4 address string (in canonical dotted decimal) is in a private,
 * loopback, link-local, carrier-grade NAT, or reserved range.
 */
export function isProhibitedIPv4(ip: string): { prohibited: boolean; reason?: string } {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return { prohibited: true, reason: "Malformed IPv4 address" };
  }

  const [a, b] = parts;

  // Loopback (127.0.0.0/8)
  if (a === 127) {
    return { prohibited: true, reason: "Loopback IP address rejected" };
  }

  // Current network / Zero (0.0.0.0/8)
  if (a === 0) {
    return { prohibited: true, reason: "Unspecified/zero network IP address rejected" };
  }

  // Private networks (RFC 1918)
  // 10.0.0.0/8
  if (a === 10) {
    return { prohibited: true, reason: "Private network IP address rejected (10.0.0.0/8)" };
  }
  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) {
    return { prohibited: true, reason: "Private network IP address rejected (172.16.0.0/12)" };
  }
  // 192.168.0.0/16
  if (a === 192 && b === 168) {
    return { prohibited: true, reason: "Private network IP address rejected (192.168.0.0/16)" };
  }

  // Link-Local / Cloud Metadata (RFC 3927: 169.254.0.0/16)
  if (a === 169 && b === 254) {
    return { prohibited: true, reason: "Link-local / cloud metadata IP address rejected (169.254.0.0/16)" };
  }

  // Carrier-grade NAT (100.64.0.0/10: 100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) {
    return { prohibited: true, reason: "Carrier-grade NAT IP address rejected (100.64.0.0/10)" };
  }

  // Broadcast (255.255.255.255)
  if (a === 255) {
    return { prohibited: true, reason: "Broadcast IP address rejected" };
  }

  // Multicast (224.0.0.0/4) & Reserved (240.0.0.0/4)
  if (a >= 224) {
    return { prohibited: true, reason: "Multicast or reserved IP address rejected" };
  }

  // Direct public numerical IP addresses are prohibited for question images (domain names required)
  return { prohibited: true, reason: "Direct numerical IP address prohibited; domain name required" };
}

/**
 * Checks whether an IPv6 host string is in a loopback, unspecified, link-local,
 * unique local (ULA), or IPv4-mapped range.
 */
export function isProhibitedIPv6(rawHost: string): { prohibited: boolean; reason?: string } {
  const clean = rawHost.replace(/^\[|\]$/g, '').toLowerCase();

  // Loopback (::1)
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1') {
    return { prohibited: true, reason: "IPv6 loopback address rejected" };
  }

  // Unspecified (::)
  if (clean === '::' || clean === '0:0:0:0:0:0:0:0') {
    return { prohibited: true, reason: "IPv6 unspecified address rejected" };
  }

  // IPv6 Link-Local (fe80::/10)
  if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
    return { prohibited: true, reason: "IPv6 link-local address rejected" };
  }

  // IPv6 Unique Local Address (fc00::/7)
  if (clean.startsWith('fc') || clean.startsWith('fd')) {
    return { prohibited: true, reason: "IPv6 unique local address rejected (fc00::/7)" };
  }

  // IPv4-mapped IPv6
  if (clean.includes('::ffff:') || clean.startsWith('ffff:')) {
    return { prohibited: true, reason: "IPv4-mapped IPv6 address rejected" };
  }

  return { prohibited: true, reason: "Direct numerical IPv6 address prohibited; domain name required" };
}

/**
 * Validates an image URL strictly against SSRF attacks:
 * 1. Enforces HTTPS only (rejects HTTP, file, ftp, data, etc.).
 * 2. Rejects embedded credentials (username/password).
 * 3. Rejects non-standard ports (allows only 443 or default).
 * 4. Rejects localhost, loopback, private networks, link-local, and cloud metadata.
 * 5. Rejects numerical IP addresses (requires valid fully-qualified domain names).
 * 6. Supports optional domain allowlisting via ALLOWED_IMAGE_HOSTS environment variable.
 */
export function validateImageUrl(urlStr: string): { valid: boolean; error?: string; url?: URL } {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: "Missing or invalid image URL string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, error: "Malformed URL syntax" };
  }

  // 1. HTTPS only
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: `Invalid protocol: "${parsed.protocol}". Only HTTPS is permitted for image URLs.` };
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, error: "URLs containing user credentials are prohibited" };
  }

  // 3. Port must be standard 443 or omitted
  if (parsed.port && parsed.port !== '443') {
    return { valid: false, error: `Non-standard port "${parsed.port}" is prohibited. Only standard HTTPS (443) is allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 4. Reject empty or single-character hostname
  if (!hostname || hostname.length < 3) {
    return { valid: false, error: "Invalid hostname" };
  }

  // Normalize hostname: strip any trailing dots from FQDN
  const normalizedHostname = hostname.replace(/\.+$/, '');

  // 5. Reject dynamic DNS services that resolve to arbitrary / private IPs (SSRF defense)
  const DYNAMIC_DNS_DOMAINS = [
    'nip.io',
    'sslip.io',
    'xip.io',
    'localtest.me',
    'lvh.me',
    'vcap.me'
  ];
  const isDynamicDns = DYNAMIC_DNS_DOMAINS.some(
    domain => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
  );
  if (isDynamicDns) {
    return { valid: false, error: `Dynamic DNS service rejected: "${hostname}"` };
  }

  // 6. Reject localhost and internal domain names
  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname.endsWith('.local') ||
    normalizedHostname.endsWith('.internal') ||
    normalizedHostname.endsWith('.lan') ||
    normalizedHostname.endsWith('.home.arpa') ||
    normalizedHostname === 'metadata.google.internal' ||
    normalizedHostname === 'instance-data'
  ) {
    return { valid: false, error: `Prohibited internal/local hostname: "${hostname}"` };
  }

  // 7. Check for direct numerical IPv4 (or WHATWG normalized IPv4)
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(normalizedHostname)) {
    const ipCheck = isProhibitedIPv4(normalizedHostname);
    return { valid: false, error: ipCheck.reason || "Direct IP address prohibited" };
  }

  // 8. Check for direct IPv6
  if (normalizedHostname.startsWith('[') && normalizedHostname.endsWith(']')) {
    const ipCheck = isProhibitedIPv6(normalizedHostname);
    return { valid: false, error: ipCheck.reason || "Direct IPv6 address prohibited" };
  }

  // 9. Require at least one dot in hostname (fully qualified domain name)
  if (!normalizedHostname.includes('.')) {
    return { valid: false, error: `Unqualified hostname "${hostname}" is prohibited; fully-qualified domain name required.` };
  }

  // 10. Optional allowlist check if ALLOWED_IMAGE_HOSTS is configured
  const allowedHostsEnv = getEnv('ALLOWED_IMAGE_HOSTS');
  if (allowedHostsEnv && allowedHostsEnv.trim()) {
    const allowedPatterns = allowedHostsEnv.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    const matches = allowedPatterns.some(pattern => {
      if (pattern.startsWith('*.')) {
        const root = pattern.slice(2);
        return normalizedHostname === root || normalizedHostname.endsWith(`.${root}`);
      }
      return normalizedHostname === pattern;
    });
    if (!matches) {
      return { valid: false, error: `Hostname "${hostname}" is not in the allowed image host allowlist.` };
    }
  }

  return { valid: true, url: parsed };
}

/**
 * Inspects initial byte signatures (magic numbers) to reliably identify image formats.
 * Supports JPEG, PNG, GIF, and WEBP.
 */
export function detectImageMimeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png';
  }

  // GIF: GIF87a or GIF89a (47 49 46 38 [37|39] 61)
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif';
  }

  // WEBP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }

  return null;
}

/**
 * Maximum permitted image payload size (10 MB).
 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760 bytes

/**
 * Safely downloads an image with SSRF protection, redirect validation,
 * hard 10MB streaming size limit, and strict MIME/magic-number verification.
 */
export async function fetchImageSafely(
  imageUrl: string,
  customFetch: typeof fetch = fetch,
  timeoutMs: number = 10_000
): Promise<{ mimeType: string; base64: string }> {
  // Validate initial URL
  const initialValidation = validateImageUrl(imageUrl);
  if (!initialValidation.valid || !initialValidation.url) {
    throw new Error(`SSRF defense rejected image URL: ${initialValidation.error}`);
  }

  let currentUrl = imageUrl;
  let redirectsRemaining = 3;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (true) {
      const res = await customFetch(currentUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual'
      });

      // Handle HTTP redirects (301, 302, 303, 307, 308)
      if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
        if (redirectsRemaining <= 0) {
          throw new Error("Too many redirects (exceeded maximum of 3)");
        }
        redirectsRemaining--;

        const locationHeader = res.headers.get('location');
        if (!locationHeader) {
          throw new Error(`HTTP ${res.status} redirect missing Location header`);
        }

        // Resolve redirect URL (handles relative paths)
        let resolvedRedirect: URL;
        try {
          resolvedRedirect = new URL(locationHeader, currentUrl);
        } catch {
          throw new Error(`Invalid redirect Location URL: ${locationHeader}`);
        }

        // Validate redirect target URL against SSRF defense
        const redirectValidation = validateImageUrl(resolvedRedirect.toString());
        if (!redirectValidation.valid) {
          throw new Error(`SSRF defense rejected redirect destination: ${redirectValidation.error}`);
        }

        currentUrl = resolvedRedirect.toString();
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} downloading image`);
      }

      // Check Content-Length header if present
      const clHeader = res.headers.get('content-length');
      if (clHeader) {
        const cl = parseInt(clHeader, 10);
        if (!isNaN(cl) && cl > MAX_IMAGE_SIZE_BYTES) {
          throw new Error(`Image size exceeds 10MB limit (Content-Length: ${cl} bytes)`);
        }
      }

      // Check Content-Type header
      const rawContentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (rawContentType === 'text/html' || rawContentType.startsWith('text/')) {
        throw new Error(`Rejected non-image Content-Type: ${rawContentType}`);
      }

      const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
      if (rawContentType && rawContentType !== 'application/octet-stream' && !ALLOWED_MIME_TYPES.has(rawContentType)) {
        throw new Error(`Unsupported image MIME type: ${rawContentType}`);
      }

      // Stream response body and enforce hard 10MB limit on actual downloaded bytes
      let merged: Uint8Array;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > MAX_IMAGE_SIZE_BYTES) {
                await reader.cancel("Payload exceeded 10MB limit");
                controller.abort();
                throw new Error(`Image payload exceeded 10MB limit (downloaded ${totalBytes} bytes)`);
              }
              chunks.push(value);
            }
          }
        } catch (streamErr) {
          try {
            await reader.cancel();
          } catch { /* ignore */ }
          throw streamErr;
        } finally {
          reader.releaseLock();
        }

        merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } else {
        // Fallback for mocks without streaming body
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_IMAGE_SIZE_BYTES) {
          throw new Error(`Image payload exceeded 10MB limit (size: ${buf.byteLength} bytes)`);
        }
        merged = new Uint8Array(buf);
      }

      if (merged.byteLength === 0) {
        throw new Error("Downloaded image payload is empty (0 bytes)");
      }

      // Detect and validate MIME type from actual magic numbers
      const detectedMime = detectImageMimeType(merged);
      if (!detectedMime) {
        throw new Error("Invalid or unsupported image data (unknown file signature)");
      }

      if (rawContentType && ALLOWED_MIME_TYPES.has(rawContentType)) {
        if (rawContentType !== detectedMime) {
          throw new Error(`MIME type mismatch: header declared ${rawContentType} but bytes detected as ${detectedMime}`);
        }
      } else if (rawContentType && rawContentType !== 'application/octet-stream' && !ALLOWED_MIME_TYPES.has(rawContentType)) {
        throw new Error(`Unsupported image MIME type: ${rawContentType}`);
      }

      const finalMime = detectedMime;

      // Safe chunked base64 conversion (avoids V8 call stack overflow)
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < merged.length; i += chunkSize) {
        const slice = merged.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...slice);
      }
      const base64 = btoa(binary);

      return { mimeType: finalMime, base64 };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Normalizes text for conservative exact-match comparison.
 * Trims whitespace, lowercases, removes standard punctuation, and collapses whitespace.
 */
export function normalizeAnswerText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ');
}

/**
 * Confidently determines whether a rubric represents a canonical answer/entity (or list of exact synonyms),
 * as opposed to a concept/keyword list (e.g. "Zechariah Vision Mute") or descriptive pedagogical instruction.
 */
export function isCanonicalAnswerRubric(aiRubric: string): boolean {
  if (!aiRubric) return false;
  const trimmed = aiRubric.trim();

  // 1. Concept lists or sentences containing punctuation
  if (/[,;:.]/.test(trimmed)) {
    return false;
  }

  // 2. Instructional keywords or pedagogical markers
  const lower = trimmed.toLowerCase();
  if (/\b(must|should|convey|explain|describe|mention|criteria|because|identifies|rubric|points?|verse|event|key|concept|summary|note)\b/.test(lower)) {
    return false;
  }

  // 3. Alternative answers separated by / or | or 'or'
  const rawAlternatives = trimmed.split(/\s*[/|]\s*|\s+or\s+/i);
  if (rawAlternatives.length > 1) {
    return rawAlternatives.every(alt => {
      const words = alt.trim().split(/\s+/).filter(Boolean);
      return words.length >= 1 && words.length <= 3;
    });
  }

  // 4. Single phrase rubric
  const words = trimmed.split(/\s+/).filter(Boolean);
  // 1 or 2 words are canonical entity/name answers
  if (words.length <= 2) {
    return true;
  }

  // 3 or more words without sentence syntax represent keyword lists (e.g. "Zechariah Vision Mute")
  return false;
}

/**
 * Evaluates whether a student answer matches the rubric via conservative deterministic comparison.
 * Returns points (2) and isCorrect (true) if matched; null otherwise.
 */
export function evaluateExactMatch(
  studentAnswer: string,
  aiRubric: string
): { points: number; isCorrect: boolean; method: 'exact_match' } | null {
  if (!studentAnswer || !aiRubric) return null;

  if (!isCanonicalAnswerRubric(aiRubric)) {
    return null;
  }

  const cleanStudent = normalizeAnswerText(studentAnswer);
  const cleanRubric = normalizeAnswerText(aiRubric);

  if (!cleanStudent || !cleanRubric) return null;

  // 1. Direct normalized match
  if (cleanStudent === cleanRubric) {
    return { points: 2, isCorrect: true, method: 'exact_match' };
  }

  // 2. Check alternatives separated by / or | or 'or'
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

/**
 * Loads the active AI provider configuration from the database.
 * Strictly fail-closed: requires explicit database enablement to activate AI grading.
 */
export async function getAiProviderConfig(fetchFn = fetch): Promise<AiProviderConfig> {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[grade-answer] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment. Failing closed.");
    return {
      provider: 'openrouter',
      primary_model: '',
      fallback_model: '',
      enabled: false,
      state: 'db_retrieval_failure'
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetchFn(
      `${supabaseUrl}/rest/v1/ai_provider_config?select=provider,primary_model,fallback_model,enabled&id=eq.1&limit=1`,
      {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      }
    );
    clearTimeout(timeoutId);

    if (response.ok) {
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0];
        const isEnabled = row.enabled === true;
        const provider = (row.provider || '').trim();
        const primaryModel = (row.primary_model || '').trim();
        const fallbackModel = (row.fallback_model || '').trim();

        if (provider !== 'openrouter' || !primaryModel || !fallbackModel) {
          console.error(`[grade-answer] Invalid AI configuration in database: provider=${provider}, primary=${primaryModel}`);
          return {
            provider,
            primary_model: primaryModel,
            fallback_model: fallbackModel,
            enabled: false,
            state: 'invalid_configuration'
          };
        }

        return {
          provider,
          primary_model: primaryModel,
          fallback_model: fallbackModel,
          enabled: isEnabled,
          state: isEnabled ? 'explicitly_enabled' : 'explicitly_disabled'
        };
      } else {
        console.warn("[grade-answer] ai_provider_config table is empty. Failing closed.");
        return {
          provider: 'openrouter',
          primary_model: '',
          fallback_model: '',
          enabled: false,
          state: 'not_configured'
        };
      }
    } else {
      console.error(`[grade-answer] Database returned HTTP ${response.status} when querying ai_provider_config. Failing closed.`);
      return {
        provider: 'openrouter',
        primary_model: '',
        fallback_model: '',
        enabled: false,
        state: 'db_retrieval_failure'
      };
    }
  } catch (err) {
    console.error("[grade-answer] Network/DB exception querying ai_provider_config. Failing closed:", err);
    return {
      provider: 'openrouter',
      primary_model: '',
      fallback_model: '',
      enabled: false,
      state: 'db_retrieval_failure'
    };
  }
}

export interface OpenRouterCallResult {
  success: boolean;
  score?: number;
  feedback?: string;
  model: string;
  latencyMs: number;
  error?: string;
  category?: 'provider_error' | 'timeout' | 'rate_limit' | 'empty_response' | 'parse_error' | 'schema_validation_error';
  status?: number;
  requestId?: string;
}

/**
 * Invokes OpenRouter Chat Completions API with strict timeout and validation.
 */
export async function callOpenRouterModel(
  apiKey: string,
  modelName: string,
  prompt: string,
  imagePayload: { mimeType: string; base64: string } | null,
  timeoutMs = 15000,
  fetchFn = fetch
): Promise<OpenRouterCallResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    if (imagePayload) {
      userContent = [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${imagePayload.mimeType};base64,${imagePayload.base64}`
          }
        }
      ];
    } else {
      userContent = prompt;
    }

    const payload = {
      model: modelName,
      messages: [
        {
          role: "system",
          content: "You are an expert Bible study educator grading a student's answer for an interactive quiz. Evaluate the student answer against the rubric and context. Output ONLY strict JSON with properties: \"score\" (number between 0 and 10) and \"feedback\" (concise explanation). Do not wrap in markdown fences."
        },
        {
          role: "user",
          content: userContent
        }
      ],
      response_format: {
        type: "json_object"
      },
      temperature: 0.1,
      max_tokens: 300
    };

    const response = await fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://daatquiz.org",
        "X-Title": "Daat Quiz Evaluation Platform"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const requestId = response.headers.get("x-request-id") || undefined;

    if (!response.ok) {
      const errBody = await response.text();
      const status = response.status;
      if (status === 429) {
        return {
          success: false,
          model: modelName,
          latencyMs,
          status,
          category: 'rate_limit',
          error: `OpenRouter rate limit (HTTP 429): ${errBody.slice(0, 200)}`,
          requestId
        };
      }
      return {
        success: false,
        model: modelName,
        latencyMs,
        status,
        category: 'provider_error',
        error: `OpenRouter error (HTTP ${status}): ${errBody.slice(0, 200)}`,
        requestId
      };
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;

    if (!rawContent) {
      return {
        success: false,
        model: modelName,
        latencyMs,
        category: 'empty_response',
        error: "Empty message content returned in OpenRouter choice",
        requestId
      };
    }

    // Clean any accidental Markdown code blocks
    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Regex recovery for minor formatting issues
      const scoreMatch = cleaned.match(/"score"\s*:\s*(\d+(\.\d+)?)/);
      const feedbackMatch = cleaned.match(/"feedback"\s*:\s*"([^"]+)"/);
      if (scoreMatch) {
        parsed = {
          score: parseFloat(scoreMatch[1]),
          feedback: feedbackMatch ? feedbackMatch[1] : 'Evaluated by AI'
        };
      } else {
        return {
          success: false,
          model: modelName,
          latencyMs,
          category: 'parse_error',
          error: `Failed to parse AI response into valid JSON: ${cleaned.slice(0, 150)}`,
          requestId
        };
      }
    }

    // Strict Score & Schema Validation
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        success: false,
        model: modelName,
        latencyMs,
        category: 'schema_validation_error',
        error: "Parsed AI response is not a valid JSON object",
        requestId
      };
    }

    const scoreNum = Number(parsed.score);
    if (typeof parsed.score !== 'number' || isNaN(scoreNum) || !isFinite(scoreNum) || scoreNum < 0 || scoreNum > 10) {
      return {
        success: false,
        model: modelName,
        latencyMs,
        category: 'schema_validation_error',
        error: `Invalid score returned: ${parsed.score}. Expected finite number between 0 and 10.`,
        requestId
      };
    }

    if (typeof parsed.feedback !== 'string' || !parsed.feedback.trim()) {
      return {
        success: false,
        model: modelName,
        latencyMs,
        category: 'schema_validation_error',
        error: "Missing or empty feedback string in AI response",
        requestId
      };
    }

    return {
      success: true,
      score: scoreNum,
      feedback: parsed.feedback.trim(),
      model: modelName,
      latencyMs,
      requestId
    };

  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      return {
        success: false,
        model: modelName,
        latencyMs,
        category: 'timeout',
        error: `Request timed out after ${timeoutMs}ms`
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      model: modelName,
      latencyMs,
      category: 'provider_error',
      error: `Network/connection error: ${message}`
    };
  }
}

/**
 * Core Request Handler for grade-answer edge function.
 */
export async function handleGradeAnswer(
  req: Request,
  customFetch: typeof fetch = fetch,
  leaseDurationMs: number = 120_000
): Promise<Response> {
  // 1. Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabaseUrl: string | undefined;
  let serviceRoleKey: string | undefined;
  let answerId: number | null = null;
  let claimToken: string | null = null;

  try {
    supabaseUrl = getEnv('SUPABASE_URL');
    serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[grade-answer] Fatal: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment");
      return new Response(
        JSON.stringify({ error: "Server runtime configuration missing", category: "internal_error" } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // =========================================================================
    // 2. SECURITY: AUTHENTICATION CHECK (Verify Supabase JWT identity)
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          error: "Missing or invalid Authorization header. A valid user session is required.",
          category: "unauthorized"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    let authenticatedUserId: string;

    try {
      const userRes = await customFetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': serviceRoleKey
        }
      });

      if (!userRes.ok) {
        return new Response(
          JSON.stringify({
            error: "Authentication failed: User token is expired or invalid.",
            category: "unauthorized"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }

      const userData = await userRes.json();
      if (!userData || !userData.id) {
        return new Response(
          JSON.stringify({
            error: "Authentication failed: Could not determine caller identity.",
            category: "unauthorized"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }

      authenticatedUserId = userData.id;
    } catch (authErr) {
      console.error("[grade-answer] Auth verification exception:", authErr);
      return new Response(
        JSON.stringify({
          error: "Failed to verify user authentication token",
          category: "unauthorized"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // =========================================================================
    // 3. PARSE & VALIDATE REQUEST BODY
    // =========================================================================
    let body: GradeAnswerRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON request body", category: "missing_fields" } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const attemptId = body.attemptId;
    answerId = body.answerId;

    if (!attemptId || typeof attemptId !== 'number') {
      return new Response(
        JSON.stringify({
          error: "Missing required parameter: attemptId (numeric attempt ID)",
          category: "missing_fields"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!answerId || typeof answerId !== 'number') {
      return new Response(
        JSON.stringify({
          error: "Missing required parameter: answerId (numeric user_answer ID)",
          category: "missing_fields"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // =========================================================================
    // 4. SECURITY: AUTHORIZATION CHECK (Verify attempt ownership & state)
    // =========================================================================
    const attemptRes = await customFetch(
      `${supabaseUrl}/rest/v1/quiz_attempts?id=eq.${attemptId}&select=id,user_id,completed_at,quiz_id,is_graded&limit=1`,
      {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!attemptRes.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to query quiz attempt for authorization", category: "internal_error" } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const attempts = await attemptRes.json();
    if (!Array.isArray(attempts) || attempts.length === 0) {
      return new Response(
        JSON.stringify({ error: `Quiz attempt ${attemptId} not found`, category: "not_found" } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    const attempt = attempts[0];

    // Check ownership: caller must be owner of attempt or admin
    let isAuthorized = attempt.user_id === authenticatedUserId;
    if (!isAuthorized) {
      const adminRes = await customFetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${authenticatedUserId}&role=eq.admin&select=id&limit=1`,
        {
          headers: {
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      if (adminRes.ok) {
        const adminRows = await adminRes.json();
        if (Array.isArray(adminRows) && adminRows.length > 0) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({
          error: "Forbidden: You are not authorized to grade this quiz attempt",
          category: "forbidden"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Prevent grading an uncompleted attempt
    if (!attempt.completed_at) {
      return new Response(
        JSON.stringify({
          error: "Cannot evaluate answers for an incomplete or in-progress quiz attempt",
          category: "invalid_attempt_state"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // =========================================================================
    // 5. AUTHORITATIVE DATA LOADING & IDEMPOTENCY CHECKS
    // =========================================================================
    // Query authoritative answer (strictly requiring claim recovery schema)
    const ansRes = await customFetch(
      `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&attempt_id=eq.${attemptId}&select=id,question_id,text_answer,ai_score,is_correct,grading_status,graded_at,claim_token,claim_expires_at&limit=1`,
      {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!ansRes.ok) {
      const errText = await ansRes.text().catch(() => "");
      console.error(`[grade-answer] Failed to query answer record (HTTP ${ansRes.status}):`, errText);
      if (ansRes.status === 400 && (errText.includes("claim_token") || errText.includes("claim_expires_at") || errText.includes("PGRST204") || errText.includes("column"))) {
        return new Response(
          JSON.stringify({
            error: "Database schema is missing required AI grading claim recovery columns (claim_token, claim_expires_at). Fail-closed.",
            category: "configuration_error"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
      return new Response(
        JSON.stringify({ error: "Failed to query answer record", category: "internal_error" } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const ansRows = await ansRes.json();
    if (!Array.isArray(ansRows) || ansRows.length === 0) {
      return new Response(
        JSON.stringify({
          error: `Answer ${answerId} does not belong to attempt ${attemptId}`,
          category: "invalid_answer"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const authoritativeAnswer = ansRows[0];

    // --- IDEMPOTENCY RULE 1: Finalized Attempt Guard ---
    if (attempt.is_graded) {
      const currentScore = typeof authoritativeAnswer.ai_score === 'number' ? authoritativeAnswer.ai_score : 0;
      const scoreTen = currentScore === 2 ? 10 : (currentScore === 1 ? 5 : 0);
      return new Response(JSON.stringify({
        score: scoreTen,
        feedback: "Answer belongs to an already graded and finalized quiz attempt.",
        model: "cached",
        method: "system",
        gradedAt: attempt.completed_at || new Date().toISOString(),
        provider: "openrouter",
        attemptedFallback: false,
        latencyMs: 0
      } as GradeAnswerSuccessResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- IDEMPOTENCY RULE 2: Answer-Level 'graded' Status (Covers 0, 1, and 2) ---
    if (authoritativeAnswer.grading_status === 'graded') {
      const currentScore = typeof authoritativeAnswer.ai_score === 'number' ? authoritativeAnswer.ai_score : 0;
      const scoreTen = currentScore === 2 ? 10 : (currentScore === 1 ? 5 : 0);
      return new Response(JSON.stringify({
        score: scoreTen,
        feedback: currentScore === 0 
          ? "Answer previously evaluated as incorrect." 
          : (currentScore === 2 ? "Answer previously evaluated with full credit." : "Answer previously evaluated with partial credit."),
        model: "cached",
        method: "system",
        gradedAt: authoritativeAnswer.graded_at || new Date().toISOString(),
        provider: "openrouter",
        attemptedFallback: false,
        latencyMs: 0
      } as GradeAnswerSuccessResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- IDEMPOTENCY RULE 3: Positive Score Guard (Fallback for pre-migration schema) ---
    if (typeof authoritativeAnswer.ai_score === 'number' && authoritativeAnswer.ai_score > 0) {
      const scoreTen = authoritativeAnswer.ai_score === 2 ? 10 : 5;
      return new Response(JSON.stringify({
        score: scoreTen,
        feedback: authoritativeAnswer.ai_score === 2
          ? "Answer previously evaluated with full credit."
          : "Answer previously evaluated with partial credit.",
        model: "cached",
        method: "system",
        gradedAt: authoritativeAnswer.graded_at || new Date().toISOString(),
        provider: "openrouter",
        attemptedFallback: false,
        latencyMs: 0
      } as GradeAnswerSuccessResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- IDEMPOTENCY RULE 4: Blank Answer Guard ---
    const authoritativeStudentAnswer = (authoritativeAnswer.text_answer || '').trim();
    if (!authoritativeStudentAnswer) {
      // Mark as graded in DB directly
      try {
        await customFetch(
          `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': serviceRoleKey,
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ai_score: 0,
              is_correct: false,
              grading_status: 'graded',
              graded_at: new Date().toISOString(),
              claim_token: null,
              claim_expires_at: null
            })
          }
        );
      } catch { /* ignore if column missing */ }

      return new Response(JSON.stringify({
        score: 0,
        feedback: "No answer provided.",
        model: "system",
        method: "system",
        gradedAt: new Date().toISOString(),
        provider: "openrouter",
        attemptedFallback: false,
        latencyMs: 0
      } as GradeAnswerSuccessResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // =========================================================================
    // 6. SERVER-SIDE CONCURRENCY: ATOMIC CLAIM LOCK WITH LEASE EXPIRATION
    // =========================================================================
    // Generates a cryptographic fencing token and sets an expiration timestamp (lease).
    // Stale claims whose lease expired are automatically reclaimed.
    claimToken = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtIso = new Date(now.getTime() + leaseDurationMs).toISOString();

    // Reclaimable conditions (strict PostgREST grammar with double-quoted timestamp):
    // 1. Pending, failed, or retry_pending
    // 2. Status is null
    // 3. Status is in_progress AND lease has expired (< now)
    // 4. Status is in_progress AND claim_expires_at is null (legacy un-expiring in_progress)
    const orParam = `(grading_status.in.(pending,failed,retry_pending),grading_status.is.null,and(grading_status.eq.in_progress,claim_expires_at.lt."${nowIso}"),and(grading_status.eq.in_progress,claim_expires_at.is.null))`;
    const claimUrl = `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&attempt_id=eq.${attemptId}&or=${encodeURIComponent(orParam)}&select=id`;

    const claimRes = await customFetch(
      claimUrl,
      {
        method: 'PATCH',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          grading_status: 'in_progress',
          claim_token: claimToken,
          claim_expires_at: expiresAtIso
        })
      }
    );

    if (claimRes.ok) {
      const claimedRows = await claimRes.json();
      if (Array.isArray(claimedRows) && claimedRows.length === 0) {
        // Another worker holds an active, unexpired lease!
        claimToken = null;
        return new Response(
          JSON.stringify({
            error: "Grading is currently in progress by another request for this answer. Please retry shortly.",
            category: "grading_in_progress"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
        );
      }
    } else {
      claimToken = null;
      // Fail closed: distinguish missing schema from syntax/auth/network errors
      const errText = await claimRes.text().catch(() => "");
      console.error(`[grade-answer] Claim acquisition failed (HTTP ${claimRes.status}):`, errText);

      if (claimRes.status === 400) {
        if (errText.includes("claim_token") || errText.includes("claim_expires_at") || errText.includes("column") || errText.includes("PGRST204")) {
          return new Response(
            JSON.stringify({
              error: "Database schema is missing required AI grading claim recovery columns (claim_token, claim_expires_at). Fail-closed.",
              category: "configuration_error"
            } as GradeAnswerErrorResponse),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }
        return new Response(
          JSON.stringify({
            error: "PostgREST claim query rejected by database server.",
            category: "internal_error"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      if (claimRes.status === 401 || claimRes.status === 403) {
        return new Response(
          JSON.stringify({
            error: "Database authorization failure during claim acquisition.",
            category: "configuration_error"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      return new Response(
        JSON.stringify({
          error: "Database unavailable during atomic claim acquisition.",
          category: "internal_error"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // =========================================================================
    // 6.5. FETCH AUTHORITATIVE QUESTION FROM DATABASE
    // =========================================================================
    const qRes = await customFetch(
      `${supabaseUrl}/rest/v1/questions?id=eq.${authoritativeAnswer.question_id}&quiz_id=eq.${attempt.quiz_id}&select=id,quiz_id,question_type,text_en,ai_rubric,image_url&limit=1`,
      {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!qRes.ok) {
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);
      return new Response(
        JSON.stringify({ error: "Failed to query question record", category: "internal_error" } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const qRows = await qRes.json();
    if (!Array.isArray(qRows) || qRows.length === 0) {
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);
      return new Response(
        JSON.stringify({
          error: `Question ${authoritativeAnswer.question_id} does not belong to the quiz for attempt ${attemptId}`,
          category: "invalid_question"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const authoritativeQuestion = qRows[0];

    if (authoritativeQuestion.question_type !== 'text' && authoritativeQuestion.question_type !== 'picture') {
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);
      return new Response(
        JSON.stringify({
          error: `Question type "${authoritativeQuestion.question_type}" does not use AI grading`,
          category: "invalid_question"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const authoritativeQuestionEn = authoritativeQuestion.text_en;
    const authoritativeAiRubric = authoritativeQuestion.ai_rubric || '';
    const authoritativeImageUrl = authoritativeQuestion.image_url || null;

    // =========================================================================
    // 6.5. DETERMINISTIC EXACT-MATCH EVALUATION (Server-side fast-path)
    // =========================================================================
    // For text questions: If the rubric is canonical and student answer matches exactly,
    // finalize server-side under the atomic claim with fencing verification, without invoking external AI providers.
    if (authoritativeQuestion.question_type === 'text') {
      const exactMatch = evaluateExactMatch(authoritativeAnswer.text_answer || '', authoritativeAiRubric);
      if (exactMatch) {
        try {
          const finalizeRes = await customFetch(
            `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&claim_token=eq.${claimToken}&grading_status=eq.in_progress&select=id`,
            {
              method: 'PATCH',
              headers: {
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify({
                ai_score: exactMatch.points,
                is_correct: exactMatch.isCorrect,
                grading_status: 'graded',
                grading_method: 'deterministic_exact',
                graded_at: new Date().toISOString(),
                ai_feedback: 'Exact match with authoritative rubric.',
                claim_token: null,
                claim_expires_at: null
              })
            }
          );

          if (finalizeRes.ok) {
            const finalRows = await finalizeRes.json();
            if (Array.isArray(finalRows) && finalRows.length === 0) {
              console.warn(`[grade-answer] Claim lost or expired for answer ${answerId} during exact match finalization.`);
              return new Response(
                JSON.stringify({
                  error: "Grading claim expired or was preempted by a newer request. Stale result discarded.",
                  category: "stale_claim"
                } as GradeAnswerErrorResponse),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
              );
            }

            return new Response(JSON.stringify({
              score: 10,
              feedback: 'Exact match with authoritative rubric.',
              model: 'deterministic_exact',
              method: 'deterministic_exact',
              gradedAt: new Date().toISOString(),
              provider: 'deterministic',
              attemptedFallback: false,
              latencyMs: 1
            } as GradeAnswerSuccessResponse), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            });
          } else {
            console.error(`[grade-answer] Database finalization failed for exact match with status ${finalizeRes.status}`);
          }
        } catch (exactErr) {
          console.error(`[grade-answer] Exception during exact match finalization:`, exactErr);
        }
      }
    }

    // =========================================================================
    // 7. AI CONFIGURATION: STRICT FAIL-CLOSED STATE MACHINE
    // =========================================================================
    const config = await getAiProviderConfig(customFetch);

    if (config.state === 'explicitly_disabled') {
      console.warn(`[grade-answer] AI grading is disabled in configuration. Preserving attempt for retry.`);
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);

      return new Response(
        JSON.stringify({
          error: "AI grading service is currently paused by administrator. Attempt remains retryable.",
          category: "service_disabled"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 503 }
      );
    }

    if (config.state === 'not_configured' || config.state === 'db_retrieval_failure') {
      console.warn(`[grade-answer] AI grading configuration missing or unavailable. Preserving attempt for retry.`);
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);

      return new Response(
        JSON.stringify({
          error: config.state === 'not_configured' ? "AI grading provider is not configured." : "Unable to retrieve AI grading configuration.",
          category: "service_disabled"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 503 }
      );
    }

    if (config.state === 'invalid_configuration') {
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);
      return new Response(
        JSON.stringify({
          error: `Invalid AI provider configuration. Only "openrouter" with valid models is supported.`,
          category: "configuration_error"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const apiKey = getEnv('OPENROUTER_API_KEY');
    if (!apiKey) {
      console.error("OPENROUTER_API_KEY environment secret is not configured in Supabase Edge Functions");
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);
      return new Response(
        JSON.stringify({
          error: "OPENROUTER_API_KEY environment variable is missing on edge runtime",
          category: "missing_env_key"
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const primaryModel = config.primary_model;
    const fallbackModel = config.fallback_model;

    // =========================================================================
    // 7.5. MULTIMODAL IMAGE PROCESSING WITH TIMEOUT & FAIL-SAFE PROTECTION
    // =========================================================================
    let imagePayload: { mimeType: string; base64: string } | null = null;
    if (authoritativeImageUrl) {
      try {
        imagePayload = await fetchImageSafely(authoritativeImageUrl, customFetch, 10_000);
      } catch (err: unknown) {
        const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('timed out'));
        console.warn("[grade-answer] Failed fetching image for multimodal evaluation:", authoritativeImageUrl, err);

        // Fail-safe: A picture question CANNOT be evaluated without its visual context
        if (authoritativeQuestion.question_type === 'picture' || isAbort) {
          await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);

          if (isAbort) {
            return new Response(
              JSON.stringify({
                error: `Image download timed out after 10000ms`,
                category: "timeout"
              } as GradeAnswerErrorResponse),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 504 }
            );
          } else {
            return new Response(
              JSON.stringify({
                error: `Failed to download required question image: ${err instanceof Error ? err.message : String(err)}`,
                category: "provider_error"
              } as GradeAnswerErrorResponse),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
            );
          }
        }
      }
    }

    // Build the established biblical grading prompt using authoritative DB records
    const prompt = `Question:
"${authoritativeQuestionEn}"

Grading Criteria / Rubric / Reference Answer:
"${authoritativeAiRubric}"

Student's Answer:
"${authoritativeStudentAnswer}"
${authoritativeImageUrl ? '\nAn image is associated with this question. Evaluate the student answer in the context of the question and image.' : ''}

GRADING GUIDELINES:
1. Rubric Format: The rubric may be a complete sentence, a key person/concept name, or a comma/space-separated list of key concepts/keywords (e.g. "Zechariah Vision Mute" or "Mary, Elizabeth, John, Womb, Leap").
2. Semantic Evaluation: Grade on meaning and biblical accuracy, NOT verbatim wording. Do NOT penalize the student simply because they used different words or synonyms (e.g. "unable to speak" = "mute", "song of praise" = "song").
3. Concise & Imperfect Answers: Accept concise answers. Do not penalize minor spelling, grammatical, or punctuation errors if the core biblical meaning is clear.
4. Partial Understanding: If the rubric lists multiple concepts, award partial points proportional to the concepts identified.
5. Strictness on Inaccuracy: Incorrect facts, wrong biblical characters, or irrelevant answers must receive 0 points.

SCORING SCALE (0 to 10 points):
- 9 to 10: Completely correct; clearly conveys the essential biblical fact, event, or person.
- 7 to 8: Mostly correct; captures the main point with minor omissions or minor imprecision.
- 4 to 6: Partial credit; demonstrates partial understanding or identifies some key elements.
- 1 to 3: Minimal credit; mentions something vaguely relevant but misses the core point.
- 0: Completely incorrect, contradicts biblical facts, or irrelevant.

OUTPUT FORMAT:
Return ONLY a valid JSON object with:
1. "score": number between 0 and 10 (integers or .5 increments)
2. "feedback": 1 or 2 concise sentences explaining the grade.`;

    // =========================================================================
    // 8. STEP 1: Attempt Primary Model (e.g. google/gemini-2.0-flash-001)
    // =========================================================================
    const primaryResult = await callOpenRouterModel(apiKey, primaryModel, prompt, imagePayload, 15000, customFetch);

    if (primaryResult.success && typeof primaryResult.score === 'number') {
      // Mark as graded in DB directly for permanent idempotency with fencing check
      const points = primaryResult.score >= 7.5 ? 2 : (primaryResult.score >= 2.0 ? 1 : 0);
      try {
        const finalizeRes = await customFetch(
          `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&claim_token=eq.${claimToken}&grading_status=eq.in_progress&select=id`,
          {
            method: 'PATCH',
            headers: {
              'apikey': serviceRoleKey,
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify({
              ai_score: points,
              is_correct: points === 2,
              grading_status: 'graded',
              graded_at: new Date().toISOString(),
              ai_feedback: primaryResult.feedback,
              claim_token: null,
              claim_expires_at: null
            })
          }
        );

        if (finalizeRes.ok) {
          const finalRows = await finalizeRes.json();
          if (Array.isArray(finalRows) && finalRows.length === 0) {
            console.warn(`[grade-answer] Claim lost or expired for answer ${answerId} (claimToken: ${claimToken}). Stale finalization rejected.`);
            return new Response(
              JSON.stringify({
                error: "Grading claim expired or was preempted by a newer request. Stale result discarded.",
                category: "stale_claim"
              } as GradeAnswerErrorResponse),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
            );
          }
        } else {
          console.error(`[grade-answer] Database finalization failed with status ${finalizeRes.status}`);
          return new Response(
            JSON.stringify({
              error: "Database finalization failed",
              category: "internal_error"
            } as GradeAnswerErrorResponse),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }
      } catch (dbErr) {
        console.error(`[grade-answer] Finalization exception:`, dbErr);
        return new Response(
          JSON.stringify({
            error: "Database finalization error",
            category: "internal_error"
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      return new Response(JSON.stringify({
        score: primaryResult.score,
        feedback: primaryResult.feedback || 'Graded according to rubric.',
        model: primaryResult.model,
        method: 'ai',
        gradedAt: new Date().toISOString(),
        provider: 'openrouter',
        attemptedFallback: false,
        latencyMs: primaryResult.latencyMs
      } as GradeAnswerSuccessResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // =========================================================================
    // 9. STEP 2: Primary Failed. Check Fallback & Multimodal Compatibility
    // =========================================================================
    console.warn(
      `[grade-answer] Primary model (${primaryModel}) failed (${primaryResult.category}: ${primaryResult.error}). Checking fallback model: ${fallbackModel}...`
    );

    if (fallbackModel && fallbackModel !== primaryModel) {
      if (imagePayload && !isModelVisionCapable(fallbackModel)) {
        console.error(
          `[grade-answer] Question requires visual evaluation, but fallback model (${fallbackModel}) is text-only. Cannot evaluate without visual context.`
        );
        // Release claim as failed (fencing-aware)
        await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);

        return new Response(
          JSON.stringify({
            error: `Primary multimodal model (${primaryModel}) failed, and configured fallback (${fallbackModel}) does not support image evaluation. Attempt preserved for retry.`,
            category: "provider_error",
            primaryError: primaryResult.error,
            modelAttempted: primaryModel
          } as GradeAnswerErrorResponse),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
        );
      }

      // Invoke Fallback Model
      const fallbackResult = await callOpenRouterModel(apiKey, fallbackModel, prompt, imagePayload, 15000, customFetch);

      if (fallbackResult.success && typeof fallbackResult.score === 'number') {
        const points = fallbackResult.score >= 7.5 ? 2 : (fallbackResult.score >= 2.0 ? 1 : 0);
        try {
          const finalizeRes = await customFetch(
            `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&claim_token=eq.${claimToken}&grading_status=eq.in_progress&select=id`,
            {
              method: 'PATCH',
              headers: {
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify({
                ai_score: points,
                is_correct: points === 2,
                grading_status: 'graded',
                graded_at: new Date().toISOString(),
                ai_feedback: fallbackResult.feedback,
                claim_token: null,
                claim_expires_at: null
              })
            }
          );

          if (finalizeRes.ok) {
            const finalRows = await finalizeRes.json();
            if (Array.isArray(finalRows) && finalRows.length === 0) {
              console.warn(`[grade-answer] Claim lost or expired for answer ${answerId} (claimToken: ${claimToken}). Stale fallback finalization rejected.`);
              return new Response(
                JSON.stringify({
                  error: "Grading claim expired or was preempted by a newer request. Stale result discarded.",
                  category: "stale_claim"
                } as GradeAnswerErrorResponse),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409 }
              );
            }
          } else {
            return new Response(
              JSON.stringify({ error: "Database finalization failed", category: "internal_error" } as GradeAnswerErrorResponse),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
            );
          }
        } catch (dbErr) {
          console.error(`[grade-answer] Fallback finalization exception:`, dbErr);
          return new Response(
            JSON.stringify({ error: "Database finalization error", category: "internal_error" } as GradeAnswerErrorResponse),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }

        return new Response(JSON.stringify({
          score: fallbackResult.score,
          feedback: fallbackResult.feedback || 'Graded according to rubric via fallback.',
          model: fallbackResult.model,
          method: 'ai',
          gradedAt: new Date().toISOString(),
          provider: 'openrouter',
          attemptedFallback: true,
          latencyMs: primaryResult.latencyMs + fallbackResult.latencyMs
        } as GradeAnswerSuccessResponse), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Fallback also failed
      await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);

      return new Response(
        JSON.stringify({
          error: `AI grading failed across primary (${primaryModel}) and fallback (${fallbackModel}) providers.`,
          category: "provider_error",
          primaryError: primaryResult.error,
          fallbackError: fallbackResult.error,
          modelAttempted: fallbackModel
        } as GradeAnswerErrorResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
      );
    }

    // No distinct fallback, release claim as failed
    await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);

    return new Response(
      JSON.stringify({
        error: `AI grading failed on primary model (${primaryModel}): ${primaryResult.error}`,
        category: primaryResult.category || "provider_error",
        modelAttempted: primaryModel
      } as GradeAnswerErrorResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 502 }
    );

  } catch (err) {
    console.error("Unexpected edge function exception in grade-answer:", err);
    // If a claim was acquired, attempt fenced release to avoid leaving row stuck in in_progress
    if (claimToken && answerId && supabaseUrl && serviceRoleKey) {
      try {
        await releaseClaimFenced(supabaseUrl, serviceRoleKey, answerId, claimToken, customFetch);
      } catch (releaseErr) {
        console.warn(`[grade-answer] Failed to release claim in top-level catch for answer ${answerId}:`, releaseErr);
      }
    }
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal edge function error',
        category: "internal_error"
      } as GradeAnswerErrorResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
}
