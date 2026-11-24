import { supabase } from '../supabaseClient.js';

// Lock to prevent concurrent grading calls for the same attempt in the same browser session
const gradingLocks = new Set<number>();

interface QuestionDetails {
  question_type: string;
  text_en: string;
  ai_rubric?: string | null;
  image_url?: string | null;
}

interface AnswerWithQuestion {
  id: number;
  question_id: number;
  text_answer?: string | null;
  ai_score?: number | null;
  is_correct?: boolean | null;
  grading_status?: string | null;
  questions: QuestionDetails | QuestionDetails[] | null;
}

/**
 * Normalizes text for conservative exact-match comparison.
 * Trims whitespace, lowercases, removes standard punctuation, and collapses whitespace.
 */
export const normalizeAnswerText = (text: string): string => {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ');
};

/**
 * Confidently determines whether a rubric represents a canonical answer/entity (or list of exact synonyms),
 * as opposed to a concept/keyword list (e.g. "Zechariah Vision Mute") or descriptive pedagogical instruction.
 * 
 * Conservative Rules:
 * 1. Punctuation containing commas, colons, or semicolons indicates a concept list or clause -> NOT canonical.
 * 2. Words like 'must', 'should', 'convey', 'explain', 'criteria' indicate pedagogical instructions -> NOT canonical.
 * 3. Slash/pipe alternatives (e.g. "Elizabeth / Elisabeth") are canonical only if every alternative is a short phrase (<= 3 words).
 * 4. Single unpunctuated phrase with 1 or 2 words (e.g. "Theophilus", "King Herod", "Gabriel", "Nazareth") -> CANONICAL.
 * 5. 3 or more unpunctuated words (e.g. "Zechariah Vision Mute", "Faith Obedience Prayer") -> Keyword list, NOT canonical.
 */
export const isCanonicalAnswerRubric = (aiRubric: string): boolean => {
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
  // These MUST be evaluated semantically by AI, not by exact string equality.
  return false;
};

/**
 * Evaluates whether a student answer matches the rubric via conservative deterministic comparison.
 * Handles exact strings, case variations, punctuation differences, and explicit / or 'or' alternatives.
 * Only applies when the rubric is confidently classified as a canonical answer (NOT a keyword list).
 */
export const evaluateExactMatch = (
  studentAnswer: string,
  aiRubric: string
): { points: number; isCorrect: boolean; method: 'exact_match' } | null => {
  if (!studentAnswer || !aiRubric) return null;

  // Guard: Only allow exact match fast-path if rubric is confidently identified as canonical
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

  // 2. Check if the rubric provides explicit alternative answers separated by / or | or ' or '
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
};

/**
 * Determines whether a user answer should be evaluated by the Edge Function or skipped.
 * Returns true if the answer needs evaluation/retry; false if it is already permanently finalized.
 */
export const shouldEvaluateAnswer = (ans: { grading_status?: string | null; ai_score?: number | null }): boolean => {
  // 1. Authoritative check: If grading_status is 'graded', answer is permanently finalized (covers score 0, 1, and 2)
  if (ans.grading_status === 'graded') {
    return false;
  }

  // 2. Backward-compatibility for legacy records lacking grading_status:
  // If grading_status is null/undefined and a positive score exists, skip
  if ((ans.grading_status === null || ans.grading_status === undefined) && typeof ans.ai_score === 'number' && ans.ai_score > 0) {
    return false;
  }

  // Otherwise, the answer is pending, failed, retry_pending, or un-graded legacy: needs evaluation
  return true;
};

export const gradeAttempt = async (attemptId: number): Promise<boolean> => {
  if (gradingLocks.has(attemptId)) {
    return false;
  }
  gradingLocks.add(attemptId);

  try {
    // 1. Fetch the attempt to confirm if it's already graded
    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('is_graded, score, max_score, quiz_id, completed_at')
      .eq('id', attemptId)
      .single();

    if (attemptError) throw attemptError;
    // Do not grade an attempt that is not yet completed
    if (!attempt || !attempt.completed_at) {
      return false;
    }
    if (attempt.is_graded) {
      return true; // Already graded
    }

    // 2. Fetch all user answers that are text or picture questions
    const { data: answers, error: answersError } = await supabase
      .from('user_answers')
      .select(`
        id,
        question_id,
        text_answer,
        ai_score,
        is_correct,
        grading_status,
        questions (
          question_type,
          text_en,
          ai_rubric,
          image_url
        )
      `)
      .eq('attempt_id', attemptId);

    if (answersError) throw answersError;

    let anyEvaluationFailed = false;

    for (const ans of (answers || [])) {
      const rawQ = (ans as unknown as AnswerWithQuestion).questions;
      const q = Array.isArray(rawQ) ? rawQ[0] : rawQ;

      if (q && (q.question_type === 'text' || q.question_type === 'picture')) {
        const studentAnsText = (ans.text_answer || '').trim();
        const rubricText = (q.ai_rubric || '').trim();

        // 1. Skip already successfully evaluated answers
        if (!shouldEvaluateAnswer(ans)) {
          continue;
        }

        // 2. Invoke Edge Function for grading (handles both exact match and AI evaluation server-side)
        try {
          const { data, error } = await supabase.functions.invoke('grade-answer', {
            body: {
              attemptId: attemptId,
              answerId: ans.id,
              questionId: ans.question_id,
              studentAnswer: studentAnsText,
              aiRubric: rubricText,
              questionEn: q.text_en || '',
              imageUrl: q.image_url || null
            }
          });

          if (error) {
            throw error;
          }

          if (!data || typeof data.score !== 'number' || isNaN(data.score)) {
            throw new Error(`Edge function returned invalid score payload: ${JSON.stringify(data)}`);
          }
          // Note: The Edge Function authoritative server-side code has already securely
          // finalized user_answers in the database with fencing token and claim clearing.
          // The student client does not perform direct writes to user_answers, preserving
          // grading integrity and preventing client-side score manipulation.
        } catch (aiErr) {
          anyEvaluationFailed = true;
          console.error(
            `AI grading failed for answer ID ${ans.id} (Question: "${q.text_en}"). Preserving prior answer and keeping attempt retryable. Error:`,
            aiErr instanceof Error ? aiErr.message : aiErr
          );
        }
      }
    }

    // 3. Re-calculate total score
    // Fetch all user answers (both AI and non-AI) to calculate the final correct score
    const { data: allAnswers, error: allAnswersError } = await supabase
      .from('user_answers')
      .select('ai_score')
      .eq('attempt_id', attemptId);

    if (allAnswersError) throw allAnswersError;

    const currentTotalScore = (allAnswers || []).reduce((sum, item) => sum + (item.ai_score || 0), 0);

    let maxScoreToUpdate = attempt.max_score;
    if (!maxScoreToUpdate || maxScoreToUpdate <= 0) {
      const { data: questions } = await supabase
        .from('questions')
        .select('question_type, question_options(id)')
        .eq('quiz_id', attempt.quiz_id);

      if (questions && questions.length > 0) {
        interface QuestionWithOpts {
          question_type: string;
          question_options?: { id: number }[];
        }
        maxScoreToUpdate = (questions as unknown as QuestionWithOpts[]).reduce((sum: number, q) => {
          if (q.question_type === 'single' || q.question_type === 'multiple') return sum + 1;
          if (q.question_type === 'text' || q.question_type === 'picture') return sum + 2;
          if (q.question_type === 'match') return sum + Math.round(((q.question_options || []).length) * 0.5);
          return sum + 1;
        }, 0);
      }
    }

    // 4. Update the attempt.
    // CRITICAL FIX: Only set is_graded = true if ALL required evaluations succeeded!
    const isFullyGraded = !anyEvaluationFailed;

    const { error: updateAttemptError } = await supabase
      .from('quiz_attempts')
      .update({
        score: currentTotalScore,
        max_score: maxScoreToUpdate || 0,
        is_graded: isFullyGraded
      })
      .eq('id', attemptId);

    if (updateAttemptError) throw updateAttemptError;

    return isFullyGraded;
  } catch (err) {
    console.error(`Error in gradeAttempt for attempt ${attemptId}:`, err);
    return false;
  } finally {
    gradingLocks.delete(attemptId);
  }
};
