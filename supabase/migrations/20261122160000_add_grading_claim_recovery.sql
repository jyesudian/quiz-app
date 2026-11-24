-- ============================================================================
-- MIGRATION: Add AI Grading Claim Leases & Concurrency Fencing Tokens
-- File: supabase/migrations/20261122160000_add_grading_claim_recovery.sql
-- Description: Adds claim_token and claim_expires_at to user_answers to support
--              atomic lease-based concurrency locking and fencing tokens.
-- Status: LOCAL IMPLEMENTATION ONLY — NOT APPLIED TO REMOTE DATABASE
-- ============================================================================

-- 1. ADD LEASE AND FENCING TOKEN COLUMNS TO USER_ANSWERS
-- claim_token: Cryptographic UUID fencing token identifying the specific worker holding the claim
-- claim_expires_at: UTC timestamp when the current in_progress lease expires (default 120s lease)
ALTER TABLE public.user_answers 
  ADD COLUMN IF NOT EXISTS claim_token UUID;

ALTER TABLE public.user_answers 
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;
