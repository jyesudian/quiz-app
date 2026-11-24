# Da'at Quiz App — Deployment Safety Audit: Critical Gap Verification

**Date:** November 22, 2026  
**Auditor:** Antigravity AI Agent  
**Environment:** Single Shared Environment (`fbkscfacvfgpbztkyqzi` — "Quiz")  
**Target Document:** `docs/single_environment_deployment_critical_gap_review.md`  
**Current Git Base:** `main` @ `e0dcf72` ("fix for quiz screen issue")  
**Operational Scope:** Pure Read-Only Audit. No code, migration, database, secret, or deployment operations executed.

---

## Executive Summary

Following the initial Deployment Preparation & Risk Audit, this second-pass safety audit was commissioned by Dev-A to resolve nine critical gaps before any deployment authorization is considered.

Because the Da'at Quiz App operates in a **single shared environment** with no staging or sandbox isolation, any defect directly impacts active students, leaderboard ranks, and live database integrity.

This audit reveals **four high/critical architectural and operational blockers** that must be resolved prior to deployment:
1. **Migration Version Collision:** Two migration files share identical 8-digit timestamp prefixes (`20261122`), which risks migration execution failure or silent skipping in Supabase CLI.
2. **Permanent Concurrency Lockout (`in_progress` Deadlock):** If an Edge Function execution times out, crashes, or loses connectivity after claiming an answer, the answer row remains permanently in `grading_status = 'in_progress'` with no lease timeout, returning HTTP 409 forever.
3. **Flawed Backup Strategy:** The proposed `CREATE TABLE IF NOT EXISTS ... AS SELECT` snapshots do not preserve constraints, indexes, identities, or RLS policies, risk retaining stale data from prior runs, and are not point-in-time consistent across tables.
4. **Unvalidated Migration Locks & Execution Time:** Adding `CHECK` constraints on `user_answers` without `NOT VALID` forces PostgreSQL to acquire an `ACCESS EXCLUSIVE` lock and perform a full table scan, blocking active quiz submissions.

---

## GAP 1 — Backup Validity and Point-in-Time Recovery

### 1. Finding
The proposed in-database table snapshots (`_snapshot_20261122_*`) are fundamentally incomplete and inadequate for disaster recovery. Furthermore, Supabase Point-in-Time Recovery (PITR) status cannot be confirmed from repository artifacts alone.

### 2. Evidence from Source Code & Architecture
In `single_environment_deployment_risk_audit.md` (Section F), the suggested backup command was:
```sql
CREATE TABLE IF NOT EXISTS public._snapshot_20261122_quiz_attempts AS 
SELECT * FROM public.quiz_attempts;
```
Analysis of PostgreSQL specification and Supabase architecture:
- **Objects NOT Preserved by `CREATE TABLE ... AS SELECT`:**
  - **Primary Keys & Unique Constraints:** Completely dropped.
  - **Foreign Key Constraints:** Completely dropped (relationships to `profiles`, `quizzes`, `questions` lost).
  - **Check Constraints:** Not copied.
  - **Column Default Values:** Not copied (`DEFAULT 'pending'` lost).
  - **Indexes:** None copied (all B-tree and composite indexes absent).
  - **Identity / Sequence Properties:** Lost (columns become plain integers, breaking auto-increment upon restore).
  - **Row Level Security (RLS) Policies:** RLS is disabled by default on CTAS tables.
  - **Triggers:** None copied.
- **Risk of `IF NOT EXISTS`:** If a dry-run or developer previously executed this query, PostgreSQL silently ignores the statement and retains the **stale snapshot** from hours or days prior.
- **Lack of Transactional Consistency:** Executing four separate CTAS statements without an explicit `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ` allows concurrent writes between queries. Answers submitted between statement 1 and statement 2 will create orphaned foreign key references in the backup.
- **Restoration Feasibility:** Restoring from these snapshots cannot be done via simple table rename (`ALTER TABLE ... RENAME`). It requires writing complex data reconciliation scripts that disable foreign keys, handle identity sequence re-syncing, and resolve primary key collisions.

### 3. Risk Level: **HIGH**

### 4. Verified Status: **VERIFIED DEFECT**

### 5. Required Action Before Deployment
1. **Explicit PITR Status:** Formally classified as **`NOT VERIFIED`**. Dev-A must verify in the Supabase Dashboard (`Database > Backups`) whether Point-in-Time Recovery is active.
2. **Mandatory Pre-Deployment Backup Method:** Dev-A must generate an offline, transactionally consistent logical backup using the Supabase CLI immediately before deployment:
   ```powershell
   # [READ-ONLY BACKUP - EXECUTE LOCALLY]
   supabase db dump --linked -f pre_deploy_schema_20261122.sql
   supabase db dump --linked --data-only -f pre_deploy_data_20261122.sql
   ```
3. If fast in-database snapshots are desired as a secondary convenience, they must be wrapped in a single transaction with explicit drops:
   ```sql
   BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
     DROP TABLE IF EXISTS public._snapshot_20261122_user_answers;
     DROP TABLE IF EXISTS public._snapshot_20261122_quiz_attempts;
     CREATE TABLE public._snapshot_20261122_quiz_attempts AS SELECT * FROM public.quiz_attempts;
     CREATE TABLE public._snapshot_20261122_user_answers AS SELECT * FROM public.user_answers;
   COMMIT;
   ```

### 6. Dev-A Approval Required: **YES**

---

## GAP 2 — Migration History Reconciliation & CLI Naming Syntax

### 1. Finding
The migration inventory contains an **ambiguous version timestamp collision** between two files, and the proposed `supabase migration repair` command in previous documentation used invalid syntax.

### 2. Evidence from Source Code & Configuration
Inspection of `supabase/migrations/`:
1. `supabase/migrations/20261121_fix_quiz_attempts_and_leaderboard.sql`
2. `supabase/migrations/20261122_fix_ai_grading_lifecycle.sql`
3. `supabase/migrations/20261122_create_ai_provider_config.sql`

- **The Version Collision:**
  Supabase CLI extracts the migration version as the numeric string preceding the first underscore. Both migration 2 and migration 3 use `20261122`.
  In PostgreSQL, the migration ledger is `supabase_migrations.schema_migrations(version text PRIMARY KEY)`.
  If two files share the same prefix `20261122`:
  - `supabase db push` will either fail with a Primary Key uniqueness violation (`duplicate key value violates unique constraint "schema_migrations_pkey"`), OR
  - Supabase CLI will record `20261122` after file 2, treat file 3 as already applied, and **silently skip creating `ai_provider_config`**!
- **Invalid CLI Syntax in Prior Report:**
  The previous audit recommended:
  `supabase migration repair --status applied 20261121_fix_quiz_attempts_and_leaderboard`
  According to official Supabase CLI syntax (`supabase migration repair [version] ... [flags]`), the CLI expects the version identifier prefix, not the full file basename.
- **Risks of Manual Migration Repair:**
  - *Completely applied manually:* Safe ONLY if remote schema exactly matches the SQL file.
  - *Partially applied manually:* Fatal. Marking as applied permanently skips any unapplied DDL statements.
  - *Executed with errors:* Leaves schema in a corrupt state with false "applied" status.
  - *Applied remotely but unrecorded in CLI:* `supabase db push` will attempt re-execution, failing on `CREATE TABLE` or `ADD COLUMN` unless 100% guarded with `IF NOT EXISTS`.

### 3. Risk Level: **CRITICAL**

### 4. Verified Status: **VERIFIED DEFECT**

### 5. Required Action Before Deployment
1. **Rename Migrations to Standard 14-Digit Timestamps:**
   Before any push, migrations must have unique sequential timestamps:
   - `20261121120000_fix_quiz_attempts_and_leaderboard.sql`
   - `20261122140000_fix_ai_grading_lifecycle.sql`
   - `20261122150000_create_ai_provider_config.sql`
2. **Object Verification Procedure Before Any Migration Repair:**
   Dev-A must run the following read-only verification query in Supabase SQL Editor:
   ```sql
   -- [READ-ONLY VERIFICATION] Inspect whether 20261121 objects already exist remotely
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_schema = 'public' 
     AND routine_name IN ('get_series_leaderboard', 'get_user_series_attempts');

   SELECT policyname 
   FROM pg_policies 
   WHERE schemaname = 'public' AND tablename = 'quizzes';
   ```
   Only if these functions and policies exist should `supabase migration repair --status applied <version>` be considered.

### 6. Dev-A Approval Required: **YES**

---

## GAP 3 — Old Edge Function Behavior During Intermediate Migration Window

### 1. Finding
During the window where database migrations are applied but the old Edge Function is still running, student submissions will not break, but answers evaluated by the old Edge Function will retain `grading_status = 'pending'`. The system will not overwrite or corrupt finalized scores.

### 2. Evidence from Source Code
- **Old Edge Function (`git show e0dcf72:supabase/functions/grade-answer/index.ts`):**
  The old Edge Function has **zero database access**. It accepts `{ studentAnswer, aiRubric, questionEn, imageUrl }` and returns `{ score, feedback }`. It never writes to `user_answers` or `quiz_attempts`.
- **Old Client Evaluator (`git show e0dcf72:src/utils/evaluator.ts`):**
  The client writes the score:
  `supabase.from('user_answers').update({ ai_score: points, is_correct: points === 2 }).eq('id', ans.id)`.
  Then finalizes the attempt:
  `supabase.from('quiz_attempts').update({ score: finalTotalScore, max_score: ..., is_graded: true }).eq('id', attemptId)`.
- **Interaction with New Schema:**
  - In `user_answers`, new columns `grading_status` (`DEFAULT 'pending'`), `grading_method`, `ai_feedback`, and `graded_at` will remain at their defaults.
  - In `quiz_attempts`, `is_graded` will be set to `true`.
- **Regrading Risk Analysis:**
  If the new Edge Function is later deployed, could it accidentally re-evaluate these answers?
  **No.** `handler.ts` (line 647) contains **Idempotency Rule 1**:
  ```typescript
  if (attempt.is_graded) {
    return new Response(JSON.stringify({ score: cachedScore, feedback: "Answer belongs to an already graded and finalized quiz attempt." ... }));
  }
  ```
  Because the old client marks `attempt.is_graded = true`, the new Edge Function immediately returns the cached score without calling OpenRouter.

### 3. Risk Level: **LOW**

### 4. Verified Status: **LOCALLY VERIFIED & CODE REVIEWED**

### 5. Required Action Before Deployment
Deploy Edge Function immediately after database migration to minimize the window where `grading_status` remains `'pending'`. Pausing the entire app is not required, as the old function does not corrupt schema state.

### 6. Dev-A Approval Required: **NO**

---

## GAP 4 — Stale `in_progress` Concurrency Lockout Risk

### 1. Finding
An answer can become **permanently stuck** in `grading_status = 'in_progress'` if an Edge Function execution crashes, times out, or fails due to network failure after the claim is written. When stuck, all future evaluations fail with **HTTP 409 forever**.

### 2. Evidence from Source Code
In `supabase/functions/grade-answer/handler.ts` (lines 745–770):
```typescript
const claimRes = await customFetch(
  `${supabaseUrl}/rest/v1/user_answers?id=eq.${answerId}&attempt_id=eq.${attemptId}&or=(grading_status.in.(pending,failed,retry_pending),grading_status.is.null)&select=id`,
  {
    method: 'PATCH',
    headers: { ... },
    body: JSON.stringify({ grading_status: 'in_progress' })
  }
);

if (claimRes.ok) {
  const claimedRows = await claimRes.json();
  if (Array.isArray(claimedRows) && claimedRows.length === 0) {
    return new Response(JSON.stringify({
      error: "Grading is currently in progress by another request for this answer. Please retry shortly.",
      category: "grading_in_progress"
    }), { status: 409 });
  }
}
```
**Failure Scenario:**
1. Request A claims the row: `grading_status` becomes `'in_progress'`.
2. OpenRouter API times out or the Deno runtime hits an uncaught boundary (wall-clock timeout, isolate termination, network socket reset).
3. The function process terminates abruptly before reaching the `catch` block (lines 998, 1052, 1073) that resets the status to `'failed'`.
4. The database row remains permanently at `grading_status = 'in_progress'`.
5. On all subsequent calls (user retries, page reloads), the PATCH filter `or=(grading_status.in.(pending,failed,retry_pending),grading_status.is.null)` **fails to match**.
6. `claimedRows.length` is 0.
7. The handler returns **HTTP 409 (`grading_in_progress`) permanently**.
8. **Current System Deficiencies:**
   - **No claim timestamp:** `user_answers` does NOT have a `claim_time` or `locked_at` column.
   - **No lease expiration:** The claim query does not allow reclaiming locks older than X minutes.
   - **No cleanup job:** There is no cron or worker resetting abandoned locks.
   - **No admin recovery RPC:** Admins cannot reset stuck locks without writing raw SQL.

### 3. Risk Level: **CRITICAL**

### 4. Verified Status: **VERIFIED DEFECT**

### 5. Required Action Before Deployment
While strict boundary instructions prohibit altering the codebase during this audit, Dev-A must review the recommended remediation design:
1. **Schema Enhancement:** Add a `locked_at TIMESTAMPTZ` column to `user_answers` in `20261122_fix_ai_grading_lifecycle.sql`.
2. **Lease Expiration in Claim Query:** Update the atomic claim query to allow reclaiming if `locked_at < NOW() - INTERVAL '2 minutes'`:
   ```sql
   UPDATE public.user_answers
   SET grading_status = 'in_progress', locked_at = NOW()
   WHERE id = $answerId 
     AND (
       grading_status IN ('pending', 'failed', 'retry_pending') 
       OR grading_status IS NULL 
       OR (grading_status = 'in_progress' AND locked_at < NOW() - INTERVAL '2 minutes')
     );
   ```
3. **Emergency Admin Query:** Dev-A must keep this manual recovery query ready in case any student gets stuck before the lease mechanism is implemented:
   ```sql
   -- [MANUAL UNSTICK QUERY FOR DEV-A]
   UPDATE public.user_answers 
   SET grading_status = 'failed' 
   WHERE grading_status = 'in_progress' 
     AND attempt_id = <ATTEMPT_ID>;
   ```

### 6. Dev-A Approval Required: **YES**

---

## GAP 5 — Complete Edge Function Rollback Strategy

### 1. Finding
The proposed rollback command:
`git checkout e0dcf72 -- supabase/functions/grade-answer/index.ts`
is **dangerously incomplete** and will cause deployment failures or broken rollbacks.

### 2. Evidence from Source Code & Git History
- **Inspection of Git Tree at `e0dcf72`:**
  ```
  supabase/functions/grade-answer/.npmrc
  supabase/functions/grade-answer/deno.json
  supabase/functions/grade-answer/index.ts (128 lines, monolithic Gemini)
  ```
- **Inspection of Current Working Tree:**
  ```
  supabase/functions/grade-answer/.npmrc
  supabase/functions/grade-answer/deno.json
  supabase/functions/grade-answer/index.ts (modified, imports handler.ts)
  supabase/functions/grade-answer/handler.ts (untracked new file, 40KB)
  ```
- **Why the Prior Rollback Fails:**
  1. `handler.ts` is a new file. If tracked, checking out only `index.ts` leaves `handler.ts` in the deployment directory.
  2. **Secret Dependency:** The previous Edge Function strictly required `GEMINI_API_KEY`:
     ```typescript
     const apiKey = Deno.env.get('GEMINI_API_KEY');
     if (!apiKey) {
       throw new Error("GEMINI_API_KEY environment variable is missing");
     }
     ```
     If Dev-A removed `GEMINI_API_KEY` when adding `OPENROUTER_API_KEY`, redeploying the old `index.ts` will crash on every request with HTTP 400!

### 3. Risk Level: **HIGH**

### 4. Verified Status: **VERIFIED DEFECT**

### 5. Required Action Before Deployment
Dev-A must adopt the complete, multi-step rollback procedure:
```powershell
# STEP 1: Verify GEMINI_API_KEY is still present in Supabase Secrets
supabase secrets list

# STEP 2: Checkout the full directory state from e0dcf72
git checkout e0dcf72 -- supabase/functions/grade-answer/

# STEP 3: Remove handler.ts if left as untracked
Remove-Item -Path supabase/functions/grade-answer/handler.ts -ErrorAction SilentlyContinue

# STEP 4: Deploy the restored Edge Function
supabase functions deploy grade-answer
```

### 6. Dev-A Approval Required: **YES**

---

## GAP 6 — Database Rollback Destructiveness Classification

### 1. Finding
The emergency database revert SQL proposed in previous documentation is **destructive** and will cause permanent data loss if executed after the system processes live student answers.

### 2. Evidence from Source Code & Migrations
The previously proposed revert SQL was:
```sql
DROP TABLE IF EXISTS public.ai_grading_logs;
DROP TABLE IF EXISTS public.ai_provider_config;
DROP FUNCTION IF EXISTS public.update_ai_models(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_ai_grading_status(BOOLEAN);
ALTER TABLE public.user_answers DROP COLUMN IF EXISTS grading_status;
ALTER TABLE public.user_answers DROP COLUMN IF EXISTS grading_method;
ALTER TABLE public.user_answers DROP COLUMN IF EXISTS ai_feedback;
ALTER TABLE public.user_answers DROP COLUMN IF EXISTS graded_at;
```

### 3. Destruction Classification Matrix

| Action | Safety Level | Impact / Data Loss Risk | Operational Recommendation |
| :--- | :---: | :--- | :--- |
| `SELECT public.set_ai_grading_status(false);` | **SAFE AT ALL TIMES** | Zero data loss. Instantly pauses AI grading with HTTP 503. | **PREFERRED EMERGENCY ACTION** |
| `DROP FUNCTION ... set_ai_grading_status` | **POTENTIALLY DESTRUCTIVE** | Disables admin ability to pause AI grading. | Avoid |
| `DROP FUNCTION ... update_ai_models` | **POTENTIALLY DESTRUCTIVE** | Disables dynamic model switching. | Avoid |
| `DROP TABLE public.ai_provider_config;` | **POTENTIALLY DESTRUCTIVE** | Loses model configurations and requires re-seeding. | Avoid |
| `DROP TABLE public.ai_grading_logs;` | **DESTRUCTIVE** | Permanently destroys all token usage audits, provider latency history, and error logs. | **DO NOT RUN IN PRODUCTION** |
| `ALTER TABLE user_answers DROP COLUMN ...` | **HIGHLY DESTRUCTIVE** | Irrevocably destroys all AI feedback text, grading timestamps, and lifecycle statuses generated since deployment. | **STRICTLY PROHIBITED** |

### 4. Verified Status: **VERIFIED RISK**

### 5. Required Action Before Deployment
Dev-A must adopt a **Forward-Fix Only** policy for database migrations. If an emergency occurs, use `set_ai_grading_status(false)` or roll back the Edge Function. Never drop database columns.

### 6. Dev-A Approval Required: **YES**

---

## GAP 7 — Verification Status of Previous Compatibility Claims

### 1. Finding
The previous audit's claims of `"100% Compatible"` were overstated. Several critical behaviors have only been simulated locally or reviewed statically; none have been tested against a live Supabase production network or actual OpenRouter endpoints.

### 2. Evidence & Re-Classification Matrix

| Architecture Claim | Previous Claim | Verified Status | Actual Basis / Evidence |
| :--- | :---: | :---: | :--- |
| **Old Frontend + New Edge Function** | `100% Compatible` | **LOCALLY VERIFIED / CODE REVIEWED** | Tested with legacy body payloads in Node.js test suite. Verified that new handler parses legacy payload formats. |
| **New Frontend + Old Edge Function** | `100% Compatible` | **CODE REVIEWED** | Code review confirms new `evaluator.ts` passes superset of fields. Old Edge Function ignores extra fields. |
| **HTTP 409 Concurrency Handling** | `100% Compatible` | **LOCALLY VERIFIED** | Tested in `tests/edge_function_runtime.test.mjs` against mock database responses. |
| **Failed Grading & Retry Behavior** | `100% Compatible` | **LOCALLY VERIFIED** | Tested across 4 mock failure cycles in `tests/grading_lifecycle_and_resilience.test.mjs`. |
| **Completed Quiz Attempts Preservation** | `100% Compatible` | **LOCALLY VERIFIED** | Verified by Idempotency Rule 1 tests in `edge_function_runtime.test.mjs`. |
| **Zero-Score Idempotency** | `100% Compatible` | **LOCALLY VERIFIED** | Verified by Rule 2 tests in `edge_function_runtime.test.mjs`. |
| **Positive-Score Preservation** | `100% Compatible` | **LOCALLY VERIFIED** | Verified in `evaluator.ts` test suites. |
| **Image & Multimodal Grading** | `100% Compatible` | **LOCALLY VERIFIED (MOCKED FETCH)** | Base64 conversion and payload structure verified. Live multimodal API call was NOT executed. |
| **Edge Function JWT Verification** | `100% Compatible` | **CODE REVIEWED** | Verified code calls `${supabaseUrl}/auth/v1/user`. Has not run on live Supabase auth gateway. |
| **Live OpenRouter Model Responses** | `100% Compatible` | **EXPECTED BUT UNVERIFIED** | All tests used simulated OpenRouter JSON responses. No real API call executed. |
| **Remote Database Schema Compatibility** | `100% Compatible` | **NOT VERIFIED** | No migration has run against PostgreSQL instance `fbkscfacvfgpbztkyqzi`. |

### 3. Risk Level: **MEDIUM**

### 4. Verified Status: **RE-CLASSIFIED**

### 5. Required Action Before Deployment
Dev-A must execute an end-to-end smoke test on a single test quiz attempt immediately following Edge Function deployment before opening quizzes to students.

### 6. Dev-A Approval Required: **NO**

---

## GAP 8 — Migration Locking and Execution Time Guarantees

### 1. Finding
The previous report's claim that migrations execute in `<500ms` was unsupported speculation. Several operations acquire heavy locks that will block concurrent student quiz submissions.

### 2. Evidence from Source Code & PostgreSQL Internals
In `supabase/migrations/20261122_fix_ai_grading_lifecycle.sql`:
1. **`ALTER TABLE public.user_answers ADD COLUMN IF NOT EXISTS ... CHECK (...)`:**
   - In PostgreSQL, adding a column with an inline `CHECK` constraint acquires an **`ACCESS EXCLUSIVE`** lock.
   - An `ACCESS EXCLUSIVE` lock conflicts with **all** locks, including `SELECT` and `INSERT`. Any student attempting to submit answers while this DDL runs will experience a connection hang.
   - Crucially, because `CHECK` is added without `NOT VALID`, PostgreSQL scans all existing rows in `user_answers` under this exclusive lock to validate the constraint.
2. **`UPDATE public.user_answers ... WHERE ...` (Backfill query):**
   - Acquires `RowExclusiveLock` on `user_answers` and locks every completed answer row.
   - Data volume is **`UNVERIFIED`** because remote row counts have not been inspected. If `user_answers` has tens of thousands of rows, this write transaction will hold locks and generate transaction log contention.
3. **`ALTER TABLE public.quizzes DROP/CREATE POLICY`:**
   - Acquires `AccessExclusiveLock` on `quizzes`, blocking reads of published quizzes for the duration of the policy recreation.

### 3. Risk Level: **HIGH**

### 4. Verified Status: **UNVERIFIED EXECUTION TIME / VERIFIED LOCK RISK**

### 5. Required Action Before Deployment
1. Drop the claim of `<500ms`.
2. Schedule migration execution during a **strict off-peak maintenance window** (e.g. late night) to ensure zero active student submissions.
3. For large production tables, best practice is adding `CHECK ... NOT VALID` followed by `VALIDATE CONSTRAINT` to avoid table-scan exclusive locks.

### 6. Dev-A Approval Required: **YES**

---

## GAP 9 — Git and Vercel Deployment File Scope

### 1. Finding
The proposed `git add src/ supabase/ tests/ docs/` command is overly broad. It risks committing non-production artifacts, internal research evaluations, and ad-hoc debugging test scripts to Git and triggering unintended Vercel deployments.

### 2. Evidence from Working Directory Inspection
Running `git status --porcelain` and inspecting directories reveals:
- **`docs/ai/OPENROUTER_BIBLE_GRADING_EVALUATION.md`:** A 50KB internal research document containing preliminary provider evaluations.
- **`tests/reproduce_jessie_grading.test.mjs`:** An investigation reproduction script specific to one user incident.
- **`supabase/functions/grade-answer/handler.ts`:** Untracked new file (40KB) that MUST be explicitly staged.
- **`supabase/migrations/`:** Three migration files that must be renamed before staging.

### 3. Risk Level: **MEDIUM**

### 4. Verified Status: **VERIFIED SCOPE GAP**

### 5. Required Action Before Deployment
Dev-A must use explicit file paths rather than directory wildcards.

#### Precise Deployment File List:
```
# Frontend Source Files (Vercel Build Target):
src/utils/evaluator.ts
src/pages/TakeQuiz.tsx
src/pages/QuizResults.tsx
src/pages/StudentDashboard.tsx

# Edge Function Files (Supabase Target):
supabase/functions/grade-answer/index.ts
supabase/functions/grade-answer/handler.ts

# Database Migrations (Supabase Target):
supabase/migrations/20261121120000_fix_quiz_attempts_and_leaderboard.sql
supabase/migrations/20261122140000_fix_ai_grading_lifecycle.sql
supabase/migrations/20261122150000_create_ai_provider_config.sql

# Automated Regression Test Suite:
tests/grading_lifecycle_and_resilience.test.mjs
tests/openrouter_grading_and_fallback.test.mjs
tests/edge_function_runtime.test.mjs

# Audit Documentation:
docs/single_environment_deployment_risk_audit.md
docs/single_environment_deployment_critical_gap_review.md
```

### 6. Dev-A Approval Required: **NO**

---

## Deployment Readiness Verdict

### **VERDICT: NOT READY**

### Justification:
While local code and unit tests pass cleanly, deployment to a **single shared environment** cannot be authorized until the following mandatory blockers are resolved.

---

## Mandatory Blockers Before Deployment

1. **[BLOCKER 1 - MIGRATION COLLISION]:** Rename `supabase/migrations/20261122_create_ai_provider_config.sql` and `supabase/migrations/20261122_fix_ai_grading_lifecycle.sql` to have distinct, standard 14-digit timestamps so Supabase CLI does not experience Primary Key collisions.
2. **[BLOCKER 2 - MIGRATION RECONCILIATION]:** Dev-A must run the read-only diagnostic SQL in Supabase SQL Editor to verify which objects from `20261121` currently exist in PostgreSQL before attempting any push.
3. **[BLOCKER 3 - OFFLINE BACKUP]:** Dev-A must capture a full schema and data dump via Supabase CLI (`supabase db dump --linked`) before applying migrations.
4. **[BLOCKER 4 - STALE CLAIM REMEDIATION]:** Dev-A must review and approve the lease-expiration design for `grading_status = 'in_progress'` to eliminate the risk of permanent student lockout.
5. **[BLOCKER 5 - SECRET VERIFICATION]:** Confirm `OPENROUTER_API_KEY` is present in Supabase Edge Secrets and has active credit balance. Ensure `GEMINI_API_KEY` is retained in secrets for fallback rollback capability.

---

## Recommended Deployment Sequence (Single Shared Environment)

Once Dev-A resolves the mandatory blockers, execute strictly in this numbered order:

### Phase 1: Read-Only Verification
```powershell
# [READ-ONLY] 1. Verify all 74 unit & runtime tests pass
node --test tests/grading_lifecycle_and_resilience.test.mjs tests/openrouter_grading_and_fallback.test.mjs tests/edge_function_runtime.test.mjs

# [READ-ONLY] 2. Inspect migration history on remote project
supabase migration list

# [READ-ONLY] 3. Verify Edge Function secrets
supabase secrets list
```

### Phase 2: Backup Execution
```powershell
# [BACKUP] 4. Take full offline schema & data dump
supabase db dump --linked -f pre_deploy_schema_20261122.sql
supabase db dump --linked --data-only -f pre_deploy_data_20261122.sql
```

### Phase 3: Migration Preview & Execution
```powershell
# [PREVIEW] 5. Dry-run preview of pending migrations
supabase db push --dry-run

# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] 6. Apply database migrations
supabase db push
```

### Phase 4: Edge Function Deployment & Verification
```powershell
# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] 7. Deploy Edge Function
supabase functions deploy grade-answer

# [POST-DEPLOYMENT VERIFICATION] 8. Verify Edge Function deployment
supabase functions list
```

### Phase 5: Frontend Deployment
```powershell
# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] 9. Stage ONLY production-targeted files
git add src/utils/evaluator.ts src/pages/TakeQuiz.tsx src/pages/QuizResults.tsx src/pages/StudentDashboard.tsx supabase/functions/grade-answer/index.ts supabase/functions/grade-answer/handler.ts supabase/migrations/ tests/ docs/

# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] 10. Commit and push to main (triggers Vercel deploy)
git commit -m "feat(ai-grading): migrate to OpenRouter with hardened lifecycle and configurable models"
git push origin main
```

---

## Deployment Authorization Boundary

**CURRENT STATUS: STOPPED.**

In strict adherence to instructions:
- **NO** source code changes were made.
- **NO** database migrations were executed.
- **NO** Edge Functions were deployed.
- **NO** Vercel deployments were triggered.
- **NO** Git commits, pushes, or staging operations were executed.
- **NO** secrets were modified.

The system is held in a **`NOT READY`** state awaiting Dev-A resolution of the mandatory blockers.
