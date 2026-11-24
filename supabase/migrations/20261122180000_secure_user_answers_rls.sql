-- ============================================================================
-- MIGRATION: Secure user_answers Row Level Security & Tamper Protection
-- File: supabase/migrations/20261122180000_secure_user_answers_rls.sql
-- Description: Enforces defense-in-depth protection for user_answers:
--              1. RLS UPDATE policy: Students can update only their own answers while
--                 the quiz attempt is active (completed_at IS NULL).
--              2. Column privileges: Limits student UPDATE permissions to user answers
--                 (selected_option_id, text_answer) only.
--              3. Immutability trigger: Blocks non-service-role users from altering
--                 authoritative grading fields (ai_score, is_correct, grading_status,
--                 claim_token, claim_expires_at, ai_feedback, graded_at).
-- Status: LOCAL IMPLEMENTATION ONLY — NOT APPLIED TO REMOTE DATABASE
-- ============================================================================

-- 1. ROW LEVEL SECURITY: ENSURE RLS IS ACTIVE
ALTER TABLE public.user_answers ENABLE ROW LEVEL SECURITY;

-- 2. RLS UPDATE POLICY: SCOPED TO OWN ACTIVE (UNCOMPLETED) ATTEMPTS ONLY
-- Completed attempts (completed_at IS NOT NULL) are permanently sealed against student edits.
DROP POLICY IF EXISTS "Users can update own active answers" ON public.user_answers;
CREATE POLICY "Users can update own active answers" 
  ON public.user_answers FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.quiz_attempts 
      WHERE quiz_attempts.id = user_answers.attempt_id 
        AND quiz_attempts.user_id = auth.uid()
        AND quiz_attempts.completed_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quiz_attempts 
      WHERE quiz_attempts.id = user_answers.attempt_id 
        AND quiz_attempts.user_id = auth.uid()
        AND quiz_attempts.completed_at IS NULL
    )
  );

-- 3. IMMUTABILITY TRIGGER: PREVENT TAMPERING WITH AUTHORITATIVE GRADING FIELDS
-- Students must NEVER be able to manipulate scores or grading lifecycle states.
CREATE OR REPLACE FUNCTION public.check_user_answers_immutable_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Service role and administrative callers are permitted to finalize and grade
  IF (current_setting('role', true) = 'service_role') OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Prohibit non-service-role users from modifying grading results or lifecycle fields
  IF (OLD.ai_score IS DISTINCT FROM NEW.ai_score) OR
     (OLD.is_correct IS DISTINCT FROM NEW.is_correct) OR
     (OLD.grading_status IS DISTINCT FROM NEW.grading_status) OR
     (OLD.grading_method IS DISTINCT FROM NEW.grading_method) OR
     (OLD.claim_token IS DISTINCT FROM NEW.claim_token) OR
     (OLD.claim_expires_at IS DISTINCT FROM NEW.claim_expires_at) OR
     (OLD.ai_feedback IS DISTINCT FROM NEW.ai_feedback) OR
     (OLD.graded_at IS DISTINCT FROM NEW.graded_at) THEN
    RAISE EXCEPTION 'Access denied: Students are not permitted to modify grading or claim lifecycle fields.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_protect_user_answers_grading_fields ON public.user_answers;
CREATE TRIGGER trg_protect_user_answers_grading_fields
  BEFORE UPDATE ON public.user_answers
  FOR EACH ROW
  EXECUTE FUNCTION public.check_user_answers_immutable_fields();

-- 4. COLUMN-LEVEL PRIVILEGE RESTRICTION
-- Restrict authenticated role to updating only student response data, NOT grading columns
REVOKE UPDATE ON public.user_answers FROM authenticated;
GRANT UPDATE (selected_option_id, text_answer) ON public.user_answers TO authenticated;
