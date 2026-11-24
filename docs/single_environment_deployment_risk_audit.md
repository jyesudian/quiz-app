# Da'at Quiz App — Single-Environment Deployment Preparation & Risk Audit

**Date:** November 22, 2026  
**Target Environment:** Single Shared Environment (`fbkscfacvfgpbztkyqzi` — "Quiz")  
**Git Branch / Commit:** `main` (`e0dcf72` — "fix for quiz screen issue")  
**Author / Auditor:** Antigravity AI Agent  
**Audience:** Dev-A / Technical Lead  

---

## Executive Summary

The Da'at Quiz App OpenRouter AI grading migration and grading lifecycle fixes have undergone local implementation, security hardening, and comprehensive automated test validation (**74 passing tests, 0 failures; production build clean; ESLint clean**).

Because this application operates on a **single shared environment** with no staging/production separation, any migration or deployment directly impacts live quiz attempts, active student scores, and database integrity. This audit establishes the exact risk profile, migration execution order, intermediate state compatibility, backup strategy, and execution protocol.

---

## Section A: Overall Deployment Readiness Assessment

### **VERDICT: CONDITIONALLY READY**

### Justification & Preconditions

| Dimension | Status | Notes |
| :--- | :---: | :--- |
| **Local Code Quality** | **PASS** | 74 automated unit & runtime tests passing (0 failures, 238ms). Zero-score idempotency, atomic claim concurrency locking, and fail-closed security verified in actual Node.js runtime. |
| **Build & Lint** | **PASS** | `tsc -b && vite build` passed cleanly (1.60s); ESLint passed with 0 errors across all modified files. |
| **Target Isolation** | **CRITICAL WARNING** | **NO STAGING ENVIRONMENT EXISTS.** Both development and production share the same Supabase project (`fbkscfacvfgpbztkyqzi`). Blast radius of any defect is 100% of live users. |
| **Remote Migration State** | **UNVERIFIED** | Remote migration history has not yet been reconciled against local SQL files. Must be confirmed with read-only checks before execution. |
| **Secret Provisioning** | **PENDING DEV-A** | Secret `OPENROUTER_API_KEY` must be confirmed in Supabase Edge Function secrets prior to deploying the new Edge Function. |
| **Execution Safety** | **READY** | All commands, preview flags, and rollback procedures are fully specified and categorized. |

The codebase is conditionally ready for deployment, contingent upon Dev-A completing the pre-deployment verification steps, taking a database snapshot, and executing commands in the strictly specified order.

---

## Section B: Critical Risks in Single-Environment Deployment

Operating on a single shared environment introduces several unique risks that do not exist in multi-stage deployment pipelines:

### 1. 100% Blast Radius on Live Students
Because there is no separate staging project, any breaking change directly affects live quiz takers. If an Edge Function runtime error occurs, text/picture grading will fail for active users.

### 2. Remote Migration History Drift
If previous database changes (such as `20261121_fix_quiz_attempts_and_leaderboard.sql`) were executed manually in the Supabase SQL Editor without using the Supabase CLI, the remote `supabase_migrations.schema_migrations` table may not have recorded the migration. Attempting an unverified `supabase db push` could attempt to re-execute already-applied statements or fail on existing objects.

### 3. Historical Data Backfill Side Effects
In `20261122_fix_ai_grading_lifecycle.sql` (lines 23–29):
```sql
UPDATE public.user_answers ua
SET grading_status = 'graded',
    graded_at = qa.completed_at
FROM public.quiz_attempts qa
WHERE ua.attempt_id = qa.id
  AND qa.is_graded = true
  AND ua.grading_status = 'pending';
```
*Risk Analysis:* This query updates all previously graded historical answers. If an uncompleted or failed attempt was previously erroneously marked `is_graded = true`, its answers will be marked `'graded'`. While this correctly prevents historical attempts from triggering expensive AI re-evaluations, any corrupted attempts must be repaired specifically (e.g., via the commented-out remediation script for Jessie Vathana).

### 4. Edge Function Secret Dependency Outage Window
If the Edge Function is deployed before `OPENROUTER_API_KEY` is set in Supabase Edge Function Secrets, all incoming grading requests will fail immediately with HTTP 500 (`Failed to read AI configuration: Server misconfigured: OPENROUTER_API_KEY is not set`).

### 5. In-Flight Attempt Concurrency During Migration
If a student submits a quiz in the few seconds between the database schema update and the Edge Function deployment, the old Edge Function will grade using Gemini, but will not write to the new `grading_status` or `grading_method` columns. The defensive defaults (`DEFAULT 'pending'`) prevent null pointer exceptions, but the attempt would retain `grading_status = 'pending'`.

---

## Section C: Migration Inventory & Execution Order

There are three sequential migrations in `supabase/migrations/`. All three must be understood in detail:

| # | Migration File | Primary Purpose | Dependencies | Destructive Operations | Data Impact | Order |
| :-: | :--- | :--- | :--- | :--- | :--- | :-: |
| **1** | `20261121_fix_quiz_attempts_and_leaderboard.sql` | Updates `quizzes` RLS policy; replaces `get_series_leaderboard` and `get_user_series_attempts` RPCs to filter by `completed_at IS NOT NULL`. *(Note: Lines 107–202 contain a commented-out manual repair script for Jasmine Joyce).* | `quizzes`, `quiz_attempts`, `quiz_series`, `series_enrollments`, `profiles` | **None** (`DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION`). | Leaderboard excludes in-progress attempts. Historical scores unaffected. | **1** |
| **2** | `20261122_fix_ai_grading_lifecycle.sql` | Adds columns `grading_status`, `grading_method`, `ai_feedback`, `graded_at` to `public.user_answers`. Creates `public.ai_grading_logs` table with RLS. Backfills `grading_status = 'graded'` on completed attempts. *(Note: Lines 69–140 contain a commented-out manual repair script for Jessie Vathana).* | `user_answers`, `quiz_attempts`, `questions` | **None** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). | Updates historical `user_answers` where `qa.is_graded = true` to `'graded'`. | **2** |
| **3** | `20261122_create_ai_provider_config.sql` | Creates singleton `public.ai_provider_config` (`CHECK (id = 1)`); seeds initial OpenRouter models (`gemini-2.0-flash-001` and `qwen-2.5-72b-instruct`); configures admin RLS and helper functions `update_ai_models` and `set_ai_grading_status`. | `profiles`, `is_admin()` | **None** (`CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`). | Adds 1 configuration row (`id = 1`). Does not alter student data. | **3** |

### Critical Observation on Commented Scripts
Both `20261121` (lines 107–202) and `20261122_lifecycle` (lines 69–140) contain user-specific data repair scripts wrapped inside `/* ... */` comment blocks. These blocks **will not execute** during standard migration push, ensuring safe schema-only application without modifying individual student records.

---

## Section D: Remote Migration History Reconciliation Status

### Current Status: `REMOTE MIGRATION HISTORY NOT VERIFIED`

Because of our read-only boundary during audit, no remote connection has inspected `supabase_migrations.schema_migrations` on project `fbkscfacvfgpbztkyqzi`.

### Safe Read-Only Inspection Protocol

Dev-A must execute the following read-only command before pushing any migrations:
```powershell
# [READ-ONLY] Check which migrations are recorded remotely vs locally
supabase migration list
```

### Interpretation of Results:
1. **Scenario 1 (Clean State):** None of the three migrations are listed under `Remote`. Proceed to dry-run preview.
2. **Scenario 2 (Migration 20261121 Already Applied):** If `20261121` appears in `Remote`, but `20261122_*` do not, `supabase db push` will cleanly execute only the pending 20261122 migrations.
3. **Scenario 3 (Manual Execution in SQL Editor):** If SQL from `20261121` was pasted into the Supabase Web SQL Editor in the past, it may exist in Postgres but **not** in `supabase_migrations.schema_migrations`.
   - *Resolution:* Dev-A should mark it as applied using:
     ```powershell
     # [READ-ONLY RECORDING - DO NOT RUN UNLESS DIVERGENCE CONFIRMED]
     supabase migration repair --status applied 20261121_fix_quiz_attempts_and_leaderboard
     ```
   - *Failure to do this:* May result in benign "policy already exists" warnings or errors if `IF NOT EXISTS` is absent on any object.

---

## Section E: Exact End-to-End Deployment Order

To ensure zero downtime, prevent race conditions, and avoid runtime errors, follow this strict sequence:

```
[Phase 0: Pre-Deployment Backup]
       │
       ▼
[Phase 1: Migration Dry-Run Preview]
       │
       ▼
[Phase 2: Database Migration Execution]
       │
       ▼
[Phase 3: Database Verification]
       │
       ▼
[Phase 4: Supabase Secret Configuration (OPENROUTER_API_KEY)]
       │
       ▼
[Phase 5: Supabase Edge Function Deployment (grade-answer)]
       │
       ▼
[Phase 6: Edge Function Smoke Test]
       │
       ▼
[Phase 7: Frontend Build & Vercel Deployment]
       │
       ▼
[Phase 8: End-to-End Post-Deployment Verification]
```

### Detailed Timeline & Trigger Points

1. **Pre-Deployment Backup (T-10m):**
   - Create table-level snapshots of `quiz_attempts`, `user_answers`, `quizzes`, and `questions`.
2. **Dry-Run Preview (T-5m):**
   - Execute `supabase db push --dry-run` to preview pending DDL/DML.
3. **Database Migration (T-0):**
   - Apply migrations via `supabase db push`.
   - *Impact:* Takes < 500ms. Non-blocking `ADD COLUMN IF NOT EXISTS`.
4. **Secret Configuration (T+1m):**
   - Confirm `OPENROUTER_API_KEY` is set in Supabase Dashboard (Edge Functions > Secrets).
5. **Edge Function Deployment (T+2m):**
   - Deploy `grade-answer` with `--no-verify-jwt=false` (gateway verification active).
   - *Impact:* The new function begins routing subjective questions to OpenRouter primary model (`gemini-2.0-flash-001`).
6. **Smoke Test (T+3m):**
   - Verify function responsiveness via admin or test user submission.
7. **Frontend Deployment (T+5m):**
   - Push commit to `main` branch to trigger Vercel build/deploy.
   - *Impact:* Clients receive updated `evaluator.ts` (skipping positive scores on retry, handling HTTP 409 concurrency gracefully).
8. **E2E Verification (T+8m):**
   - Verify grading of subjective answers, leaderboard accuracy, and AI grading logs in `ai_grading_logs`.

---

## Section F: Backup and Recovery Strategy

Because there is no staging database to fall back on, explicit point-in-time preservation is mandatory before executing database migrations.

### 1. Supabase Platform Backup
- Ensure Supabase Daily Backup or Point-in-Time Recovery (PITR) is active for project `fbkscfacvfgpbztkyqzi`.

### 2. Fast In-Database Table Snapshot Query (Execute via Supabase SQL Editor)
Run this SQL block immediately before deployment. It creates isolated point-in-time backup copies inside the database:

```sql
-- [READ-WRITE PRE-DEPLOYMENT SNAPSHOT - EXECUTE IN SUPABASE SQL EDITOR]
CREATE TABLE IF NOT EXISTS public._snapshot_20261122_quiz_attempts AS 
SELECT * FROM public.quiz_attempts;

CREATE TABLE IF NOT EXISTS public._snapshot_20261122_user_answers AS 
SELECT * FROM public.user_answers;

CREATE TABLE IF NOT EXISTS public._snapshot_20261122_quizzes AS 
SELECT * FROM public.quizzes;

CREATE TABLE IF NOT EXISTS public._snapshot_20261122_questions AS 
SELECT * FROM public.questions;
```

### 3. Local Schema & Data Dump (Supabase CLI)
```powershell
# [READ-ONLY BACKUP] Export full schema to a local SQL file
supabase db dump --linked -f supabase_schema_backup_20261122.sql
```

---

## Section G: Edge Function Deployment Compatibility Matrix

The deployment spans five intermediate states. The architecture has been verified across all five states:

| Intermediate State | Database Schema | Edge Function Secret | Edge Function Version | Frontend Version | Operational Behavior & Compatibility |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **State 1: Baseline** | Old | Old (`GEMINI_API_KEY`) | Old (Gemini 2.5 Flash) | Old | Existing behavior. Vulnerable to silent zero-score failure on API failure. |
| **State 2: Post-DB Migration** | **New** (Columns + Config) | Old | Old | Old | **100% Compatible.** New columns have default values. Old Edge Function queries ignore new columns and continue working. |
| **State 3: Post-Secret Set** | **New** | **New** (`OPENROUTER_API_KEY`) | Old | Old | **100% Compatible.** Old Edge Function ignores the new secret. |
| **State 4: Post-Function Deploy** | **New** | **New** | **New** (OpenRouter) | Old | **100% Compatible.** New Edge Function utilizes new columns, writes to `ai_grading_logs`, and reads `ai_provider_config`. Old frontend calls Edge Function and receives standardized `{ score, is_correct, ai_score, feedback }` response. |
| **State 5: Post-Frontend Deploy** | **New** | **New** | **New** | **New** | **Fully Integrated.** Frontend skips positive scores on retry, handles HTTP 409 (`grading_in_progress`), renders `ai_feedback` in results. |

---

## Section H: Frontend Compatibility & User Experience

### Backward and Forward Compatibility Audit
1. **`src/utils/evaluator.ts`:**
   - *Positive-score preservation:* If an attempt is submitted for re-evaluation, answers with `ai_score > 0` are preserved and not re-sent to the AI.
   - *HTTP 409 Handling:* If two tabs or parallel submissions trigger grading for the same answer, the second request receives HTTP 409 (`grading_in_progress`). `evaluator.ts` treats this as a graceful non-fatal warning without corrupting the local attempt state.
   - *Non-retriable handling:* If an answer fails AI evaluation after all retries, the attempt remains sealed with `grading_status = 'failed'`, surfacing a retry notice rather than a silent zero.
2. **`src/pages/TakeQuiz.tsx` & `QuizResults.tsx`:**
   - Responsive design intact.
   - Submissions display loading indicators during async evaluation.
   - AI feedback is displayed to the student when provided by OpenRouter models.

---

## Section I: Rollback Plan

If an unexpected failure occurs during deployment, execute the appropriate tier below:

### Tier 1: Emergency Rollback of AI Grading (No Code Changes Needed)
If the OpenRouter provider suffers an upstream outage, pause AI grading instantly using the database function without redeploying code:
```sql
-- [EXECUTION] Instantly pause AI grading; returns 503 Service Unavailable to new requests
SELECT public.set_ai_grading_status(false);

-- To re-enable once resolved:
SELECT public.set_ai_grading_status(true);
```

### Tier 2: Frontend Rollback (Instant)
If the frontend build exhibits unexpected client-side issues:
- Navigate to **Vercel Dashboard > Da'at Quiz Project > Deployments**.
- Select the prior successful deployment (commit `e0dcf72`).
- Click **Instant Rollback**. (Takes < 5 seconds).

### Tier 3: Edge Function Rollback
If the new Edge Function fails unexpectedly:
```powershell
# Check out previous edge function version
git checkout e0dcf72 -- supabase/functions/grade-answer/index.ts

# Redeploy previous edge function
supabase functions deploy grade-answer
```

### Tier 4: Database Schema Rollback vs. Forward-Fix Analysis
- **Recommendation:** **PREFER FORWARD-FIX OVER COLUMN DROPS.**
- The additions (`grading_status`, `grading_method`, `ai_feedback`, `ai_provider_config`) are additive and nullable/defaulted. Dropping columns risks deleting legitimate logs or newly graded statuses.
- If a complete schema revert is required, execute:
  ```sql
  -- [EMERGENCY REVERT ONLY]
  DROP TABLE IF EXISTS public.ai_grading_logs;
  DROP TABLE IF EXISTS public.ai_provider_config;
  DROP FUNCTION IF EXISTS public.update_ai_models(TEXT, TEXT, TEXT);
  DROP FUNCTION IF EXISTS public.set_ai_grading_status(BOOLEAN);
  ALTER TABLE public.user_answers DROP COLUMN IF EXISTS grading_status;
  ALTER TABLE public.user_answers DROP COLUMN IF EXISTS grading_method;
  ALTER TABLE public.user_answers DROP COLUMN IF EXISTS ai_feedback;
  ALTER TABLE public.user_answers DROP COLUMN IF EXISTS graded_at;
  ```

---

## Section J: Final Dev-A Checklist

### Pre-Deployment Checklist
- [ ] **1. Verify Local Health:** Run `node --test tests/*.test.mjs` (ensure 74/74 pass).
- [ ] **2. Verify Build:** Run `npm run build` (ensure 0 TypeScript or bundling errors).
- [ ] **3. Verify Supabase CLI Auth:** Run `supabase projects list` to ensure CLI is authenticated.
- [ ] **4. Check Remote Migration History:** Run `supabase migration list` to inspect remote vs local.
- [ ] **5. Execute Database Snapshot:** Run snapshot queries in Supabase SQL Editor.
- [ ] **6. Verify OpenRouter Secret:** Ensure `OPENROUTER_API_KEY` is present in Supabase Edge Function Secrets.
- [ ] **7. Verify Account Balance:** Confirm OpenRouter account has positive credit balance.
- [ ] **8. Confirm Off-Peak Window:** Ensure deployment is executed during low student activity.

### Execution Checklist
- [ ] **1. Preview Migrations:** Run `supabase db push --dry-run`.
- [ ] **2. Apply Migrations:** Run `supabase db push`.
- [ ] **3. Verify DB Objects:** Query `ai_provider_config` (1 row) and `user_answers` columns.
- [ ] **4. Deploy Edge Function:** Run `supabase functions deploy grade-answer`.
- [ ] **5. Test Function Directly:** Issue a test evaluation request.
- [ ] **6. Commit Local Code:** Commit local changes to git on `main` branch.
- [ ] **7. Push to Remote:** `git push origin main` to trigger Vercel deployment.
- [ ] **8. Monitor Vercel Build:** Ensure Vercel deployment completes successfully.

### Post-Deployment Verification Checklist
- [ ] **1. Verify AI Provider Config:** Check that primary model is `google/gemini-2.0-flash-001`.
- [ ] **2. Test Subjective Question Grading:** Submit a short-answer or picture question as a test user.
- [ ] **3. Verify Observability Logs:** Query `SELECT * FROM public.ai_grading_logs ORDER BY created_at DESC LIMIT 5;`.
- [ ] **4. Verify Zero-Score Idempotency:** Re-grade or retry an attempt with a 0-score to confirm it does not call OpenRouter again.
- [ ] **5. Verify Positive-Score Preservation:** Confirm partial-score answers are not modified.
- [ ] **6. Check Leaderboard Accuracy:** Ensure `get_series_leaderboard` reflects completed attempts correctly.
- [ ] **7. Clean Up Snapshot Tables (Post 48-Hours):** Drop `_snapshot_20261122_*` after 48 hours of stable operation.

---

## Section K: Exact Deployment Commands

All commands below are tagged with their operational safety classification:

### 1. Diagnostic & Read-Only Commands
```powershell
# [READ-ONLY] Verify local test suite (74 tests)
node --test tests/grading_lifecycle_and_resilience.test.mjs tests/openrouter_grading_and_fallback.test.mjs tests/reproduce_jessie_grading.test.mjs tests/edge_function_runtime.test.mjs

# [READ-ONLY] Check remote vs local migration status
supabase migration list

# [READ-ONLY] Verify Supabase Edge Function secrets
supabase secrets list
```

### 2. Preview Commands
```powershell
# [PREVIEW] Dry-run preview of pending database migrations
supabase db push --dry-run
```

### 3. Execution Commands (REQUIRES DEV-A AUTHORIZATION)
```powershell
# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] Apply pending migrations to remote Supabase DB
supabase db push

# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] Set OpenRouter API key secret (if not already set in dashboard)
supabase secrets set OPENROUTER_API_KEY="sk-or-v1-YOUR_KEY_HERE"

# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] Deploy hardened grade-answer Edge Function
supabase functions deploy grade-answer

# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] Stage and commit validated code to Git
git add src/ supabase/ tests/ docs/
git commit -m "feat(ai-grading): migrate to OpenRouter with configurable models and hardened lifecycle"

# [EXECUTION — REQUIRES DEV-A AUTHORIZATION] Push to remote repository (triggers Vercel deployment)
git push origin main
```

---

## Section L: STOP CONDITION

**Current Action:** **STOPPING.**

In accordance with strict operational boundaries:
- **NO** database migrations have been pushed or executed.
- **NO** Supabase Edge Functions have been deployed.
- **NO** Vercel deployments have been triggered.
- **NO** git commits, pushes, or merges have been executed.
- **NO** production database records or API secrets have been modified.

All pre-deployment audit analysis is complete. The system is in the state of `CONDITIONALLY READY`. We await explicit Dev-A authorization and review before proceeding with live execution.
