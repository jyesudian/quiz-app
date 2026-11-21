-- ============================================================================
-- MIGRATION: Fix Quiz Visibility, Attempt Handling, and Leaderboard Filtering
-- File: supabase/migrations/20261121_fix_quiz_attempts_and_leaderboard.sql
-- ============================================================================

-- 1. RLS POLICY FIX: Allow viewing published quizzes in open series OR approved enrollments
DROP POLICY IF EXISTS "Enrolled users can view published quizzes" ON public.quizzes;
DROP POLICY IF EXISTS "Enrolled or open series users can view published quizzes" ON public.quizzes;

CREATE POLICY "Enrolled or open series users can view published quizzes" ON public.quizzes FOR SELECT
  USING (
    status = 'published' AND (
      EXISTS (
        SELECT 1 FROM public.series_enrollments
        WHERE series_enrollments.series_id = quizzes.series_id 
          AND series_enrollments.user_id = auth.uid() 
          AND series_enrollments.status = 'approved'
      )
      OR
      EXISTS (
        SELECT 1 FROM public.quiz_series
        WHERE quiz_series.id = quizzes.series_id 
          AND quiz_series.requires_approval = false
      )
    )
  );

-- 2. LEADERBOARD RPC FIX: Exclude in-progress / uncompleted attempts (completed_at IS NOT NULL)
CREATE OR REPLACE FUNCTION public.get_series_leaderboard(series_id_param BIGINT)
RETURNS TABLE (
    user_id UUID,
    name TEXT,
    score BIGINT,
    out_of BIGINT,
    rank BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH LatestUserAttempts AS (
        -- Select only the latest COMPLETED attempt for each user per quiz
        SELECT DISTINCT ON (qa.user_id, qa.quiz_id)
            qa.user_id,
            qa.quiz_id,
            qa.score,
            qa.max_score
        FROM public.quiz_attempts qa
        JOIN public.quizzes q ON qa.quiz_id = q.id
        WHERE q.series_id = series_id_param
          AND qa.completed_at IS NOT NULL
        ORDER BY qa.user_id, qa.quiz_id, qa.completed_at DESC
    ),
    UserScores AS (
        SELECT 
            lua.user_id,
            SUM(lua.score) as total_score,
            SUM(lua.max_score) as total_max_score
        FROM LatestUserAttempts lua
        GROUP BY lua.user_id
    )
    SELECT 
        us.user_id,
        p.full_name as name,
        us.total_score as score,
        us.total_max_score as out_of,
        RANK() OVER (ORDER BY us.total_score DESC) as rank
    FROM UserScores us
    JOIN public.profiles p ON p.id = us.user_id
    ORDER BY rank ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. USER SERIES ATTEMPTS RPC FIX: Exclude in-progress / uncompleted attempts
CREATE OR REPLACE FUNCTION public.get_user_series_attempts(series_id_param BIGINT, user_id_param UUID)
RETURNS TABLE (
    quiz_id BIGINT,
    quiz_title TEXT,
    score INT,
    max_score INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        q.id as quiz_id,
        q.title as quiz_title,
        qa.score as score,
        qa.max_score as max_score
    FROM public.quizzes q
    LEFT JOIN (
        -- Get the latest completed attempt for the specific user per quiz
        SELECT DISTINCT ON (quiz_attempts.quiz_id) *
        FROM public.quiz_attempts
        WHERE quiz_attempts.user_id = user_id_param
          AND quiz_attempts.completed_at IS NOT NULL
        ORDER BY quiz_attempts.quiz_id, quiz_attempts.completed_at DESC
    ) qa ON q.id = qa.quiz_id
    WHERE q.series_id = series_id_param AND q.status = 'published'
    ORDER BY q.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- PRODUCTION DATA REPAIR SCRIPT (REQUIRES EXPLICIT APPROVAL BEFORE EXECUTION)
-- Target: Repair corrupt attempt for jasmine.joyce@gmail.com on Luke-Chapter-1
-- ============================================================================

/*
-- STEP 1: READ-ONLY DRY RUN QUERY
-- Identifies the exact affected records and shows every required diagnostic field:
SELECT 
    p.id AS user_id,
    q.id AS quiz_id,
    qs.id AS series_id,
    qa.id AS attempt_id,
    p.email AS user_email,
    q.title AS quiz_title,
    qs.title AS series_title,
    CASE 
        WHEN qa.completed_at IS NOT NULL THEN 'completed' 
        ELSE 'in_progress' 
    END AS attempt_status,
    qa.completed_at AS completion_timestamp,
    qa.started_at AS start_timestamp,
    qa.score,
    qa.max_score,
    qa.is_graded AS grading_status,
    (SELECT COUNT(*) FROM public.user_answers ua WHERE ua.attempt_id = qa.id) AS related_answer_count
FROM public.quiz_attempts qa
JOIN public.profiles p ON p.id = qa.user_id
JOIN public.quizzes q ON q.id = qa.quiz_id
JOIN public.quiz_series qs ON qs.id = q.series_id
WHERE p.email = 'jasmine.joyce@gmail.com'
  AND q.title = 'Luke-Chapter-1';

-- STEP 2: COMPLETE MULTI-TABLE POINT-IN-TIME BACKUP
-- Backs up every related record that could be deleted or modified:
-- A) Backup affected quiz_attempts:
CREATE TABLE IF NOT EXISTS public._backup_quiz_attempts_20261121 AS
SELECT qa.* 
FROM public.quiz_attempts qa
JOIN public.profiles p ON p.id = qa.user_id
JOIN public.quizzes q ON q.id = qa.quiz_id
WHERE p.email = 'jasmine.joyce@gmail.com'
  AND q.title = 'Luke-Chapter-1'
  AND qa.completed_at IS NULL;

-- B) Backup any cascading user_answers for the affected attempt:
CREATE TABLE IF NOT EXISTS public._backup_user_answers_20261121 AS
SELECT ua.* 
FROM public.user_answers ua
JOIN public.quiz_attempts qa ON qa.id = ua.attempt_id
JOIN public.profiles p ON p.id = qa.user_id
JOIN public.quizzes q ON q.id = qa.quiz_id
WHERE p.email = 'jasmine.joyce@gmail.com'
  AND q.title = 'Luke-Chapter-1'
  AND qa.completed_at IS NULL;

-- C) Backup existing series_enrollments for the user before any update:
CREATE TABLE IF NOT EXISTS public._backup_series_enrollments_20261121 AS
SELECT se.*
FROM public.series_enrollments se
JOIN public.profiles p ON p.id = se.user_id
JOIN public.quiz_series qs ON qs.id = se.series_id
WHERE p.email = 'jasmine.joyce@gmail.com'
  AND qs.title = 'Advent-Luke-Study';

-- STEP 3: SAFE REPAIR (EXECUTE ONLY AFTER EXPLICIT APPROVAL)
-- Deletes the incomplete/corrupt attempt (cascades cleanly to any user_answers)
-- and releases the UNIQUE(user_id, quiz_id) constraint:
DELETE FROM public.quiz_attempts qa
USING public.profiles p, public.quizzes q
WHERE qa.user_id = p.id
  AND qa.quiz_id = q.id
  AND p.email = 'jasmine.joyce@gmail.com'
  AND q.title = 'Luke-Chapter-1'
  AND qa.completed_at IS NULL;

-- Ensures Jasmine Joyce has approved enrollment in Advent-Luke-Study:
INSERT INTO public.series_enrollments (series_id, user_id, status)
SELECT qs.id, p.id, 'approved'
FROM public.quiz_series qs, public.profiles p
WHERE qs.title = 'Advent-Luke-Study'
  AND p.email = 'jasmine.joyce@gmail.com'
ON CONFLICT (series_id, user_id) 
DO UPDATE SET status = 'approved';

-- STEP 4: VERIFICATION QUERY
SELECT 
    p.id AS user_id,
    p.email,
    qs.title AS series_title,
    se.status AS enrollment_status,
    qa.id AS attempt_id,
    qa.completed_at AS completion_timestamp
FROM public.profiles p
CROSS JOIN public.quiz_series qs
LEFT JOIN public.series_enrollments se ON se.series_id = qs.id AND se.user_id = p.id
LEFT JOIN public.quizzes q ON q.series_id = qs.id AND q.title = 'Luke-Chapter-1'
LEFT JOIN public.quiz_attempts qa ON qa.quiz_id = q.id AND qa.user_id = p.id
WHERE p.email = 'jasmine.joyce@gmail.com'
  AND qs.title = 'Advent-Luke-Study';
*/
