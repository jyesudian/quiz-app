import { supabase } from '../supabaseClient';

// Lock to prevent concurrent grading calls for the same attempt in the same browser session
const gradingLocks = new Set<number>();

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
        questions (
          question_type,
          text_en,
          ai_rubric,
          image_url
        )
      `)
      .eq('attempt_id', attemptId);

    if (answersError) throw answersError;

    for (const ans of (answers || [])) {
      const q = ans.questions as any;
      if (q && (q.question_type === 'text' || q.question_type === 'picture')) {
        // Invoke edge function
        try {
          const { data, error } = await supabase.functions.invoke('grade-answer', {
            body: {
              studentAnswer: ans.text_answer || '',
              aiRubric: q.ai_rubric || '',
              questionEn: q.text_en || '',
              imageUrl: q.image_url || null
            }
          });

          if (error) throw error;

          if (data && typeof data.score === 'number') {
            const scoreTen = data.score;
            let points = 0;
            if (scoreTen >= 7.5) {
              points = 2;
            } else if (scoreTen >= 3.5) {
              points = 1;
            } else if (scoreTen >= 2.0) {
              points = 1;
            }

            // Update user_answers table for this specific answer row
            const { error: updateAnsError } = await supabase
              .from('user_answers')
              .update({
                ai_score: points,
                is_correct: points === 2
              })
              .eq('id', ans.id);

            if (updateAnsError) throw updateAnsError;
          }
        } catch (aiErr) {
          console.error(`AI Grading failed for answer ${ans.id}`, aiErr);
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

    const finalTotalScore = (allAnswers || []).reduce((sum, item) => sum + (item.ai_score || 0), 0);

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

    // 4. Update the attempt to set is_graded = true and update the score and max_score
    const { error: updateAttemptError } = await supabase
      .from('quiz_attempts')
      .update({
        score: finalTotalScore,
        max_score: maxScoreToUpdate || 0,
        is_graded: true
      })
      .eq('id', attemptId);

    if (updateAttemptError) throw updateAttemptError;

    return true;
  } catch (err) {
    console.error(`Error in gradeAttempt for attempt ${attemptId}:`, err);
    return false;
  } finally {
    gradingLocks.delete(attemptId);
  }
};
