import { useState, useEffect } from 'react';
import { XCircle, CheckCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import type { Question } from '../types';
import { gradeAttempt } from '../utils/evaluator';

export const TakeQuiz = () => {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [attemptId, setAttemptId] = useState<number | null>(null);
  
  // Assume bilingual if any question has Tamil text
  const isBilingual = questions.some(q => q.textTa && q.textTa.trim() !== '');

  useEffect(() => {
    const fetchQuiz = async () => {
      if (!user || !quizId) return;
      try {
        // Check if user already completed or started this quiz
        const { data: existingAttempt, error: attemptCheckError } = await supabase
          .from('quiz_attempts')
          .select('id, completed_at')
          .eq('quiz_id', quizId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (attemptCheckError) {
          console.error('Error checking attempts:', attemptCheckError);
        }

        let currentAttemptId: number;

        if (existingAttempt) {
          if (existingAttempt.completed_at) {
            toast.error('You have already completed this quiz!');
            navigate('/student');
            return;
          } else {
            // In-progress attempt - resume it!
            currentAttemptId = existingAttempt.id;
            setAttemptId(currentAttemptId);
          }
        } else {
          // Create new attempt record in progress (completed_at = null)
          const { data: newAttempt, error: newAttemptError } = await supabase
            .from('quiz_attempts')
            .insert({
              quiz_id: parseInt(quizId),
              user_id: user.id,
              score: 0,
              max_score: 0,
              completed_at: null
            })
            .select()
            .single();

          if (newAttemptError) throw newAttemptError;
          currentAttemptId = newAttempt.id;
          setAttemptId(currentAttemptId);
        }

        const { data: questionsData, error: qError } = await supabase
          .from('questions')
          .select(`*, question_options(*)`)
          .eq('quiz_id', quizId)
          .order('position', { ascending: true });

        if (qError) throw qError;

        if (questionsData) {
          const mappedQuestions = questionsData.map((q: any) => ({
            id: q.id,
            type: q.question_type,
            textEn: q.text_en,
            textTa: q.text_ta || '',
            aiRubric: q.ai_rubric || '', // Hidden from student, but needed for submission reference
            imageUrl: q.image_url || '',
            options: (q.question_options || []).map((opt: any) => ({
              id: opt.id,
              en: opt.text_en,
              ta: opt.text_ta || '',
              isCorrect: opt.is_correct, // Needed for grading
              matchEn: opt.match_text_en || '',
              matchTa: opt.match_text_ta || ''
            }))
          }));
          setQuestions(mappedQuestions);

          // Retrieve any previously saved answers for this attempt
          const { data: prevAnswers, error: prevAnsError } = await supabase
            .from('user_answers')
            .select('*')
            .eq('attempt_id', currentAttemptId);

          if (!prevAnsError && prevAnswers && prevAnswers.length > 0) {
            const initialAnswers: Record<number, any> = {};
            mappedQuestions.forEach((q: any, index: number) => {
              const prevAns = prevAnswers.find((pa: any) => pa.question_id === q.id);
              if (prevAns) {
                if (q.type === 'single') {
                  initialAnswers[index] = prevAns.selected_option_id;
                } else if (q.type === 'multiple') {
                  initialAnswers[index] = prevAns.text_answer ? JSON.parse(prevAns.text_answer) : [];
                } else if (q.type === 'text' || q.type === 'picture') {
                  initialAnswers[index] = prevAns.text_answer || '';
                } else if (q.type === 'match') {
                  initialAnswers[index] = prevAns.text_answer ? JSON.parse(prevAns.text_answer) : {};
                }
              }
            });
            setAnswers(initialAnswers);
          }
        }
      } catch (err) {
        toast.error('Failed to load quiz');
        navigate('/student');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchQuiz();
  }, [quizId, navigate, user]);

  const saveAnswerToDb = async (qIndex: number, answerValue: any) => {
    // If loading or submitting, or if attemptId isn't initialized yet, skip
    if (isLoading || !attemptId || !questions[qIndex]) return;
    const q = questions[qIndex];
    
    let selectedOptionId: number | null = null;
    let textAnswer: string | null = null;
    
    if (q.type === 'single') {
      selectedOptionId = answerValue || null;
    } else if (q.type === 'multiple') {
      textAnswer = answerValue ? JSON.stringify(answerValue) : null;
    } else if (q.type === 'text' || q.type === 'picture') {
      textAnswer = answerValue || '';
    } else if (q.type === 'match') {
      textAnswer = answerValue ? JSON.stringify(answerValue) : null;
    }

    try {
      await supabase
        .from('user_answers')
        .upsert({
          attempt_id: attemptId,
          question_id: q.id,
          selected_option_id: selectedOptionId,
          text_answer: textAnswer,
          ai_score: 0,
          is_correct: false
        }, {
          onConflict: 'attempt_id,question_id'
        });
    } catch (err) {
      console.error("Exception in auto-save:", err);
    }
  };

  const [shuffledMatches, setShuffledMatches] = useState<any[]>([]);
  const [selectedPoolMatchId, setSelectedPoolMatchId] = useState<string | null>(null);

  useEffect(() => {
    if (questions.length > 0) {
      const q = questions[currentQuestion];
      if (q.type === 'match') {
        // Collect matches
        const matches = q.options.map(o => ({ id: o.id, en: o.matchEn, ta: o.matchTa }));
        // Shuffle the options to create the right-side list
        const shuffled = [...matches].sort(() => Math.random() - 0.5);
        setShuffledMatches(shuffled);

        // Initialize answers with an empty map if not present
        if (!answers[currentQuestion]) {
          const initialMap: Record<string, string> = {};
          q.options.forEach(opt => {
            initialMap[String(opt.id)] = '';
          });
          setAnswers(prev => ({ ...prev, [currentQuestion]: initialMap }));
        }
      }
    }
    // Clear selection on question change
    setSelectedPoolMatchId(null);
  }, [currentQuestion, questions]);

  const handleDragStart = (e: React.DragEvent, matchId: string) => {
    e.dataTransfer.setData("matchId", matchId);
  };

  const handleDrop = (e: React.DragEvent, leftOptId: string) => {
    e.preventDefault();
    const matchId = e.dataTransfer.getData("matchId");
    if (matchId) {
      assignMatch(leftOptId, matchId);
    }
  };

  const assignMatch = (leftOptId: string, matchId: string) => {
    const currentMap = { ...(answers[currentQuestion] || {}) };
    
    // If this matchId was already assigned to another left item, remove it from there
    Object.keys(currentMap).forEach(key => {
      if (String(currentMap[key]) === String(matchId)) {
        currentMap[key] = '';
      }
    });

    currentMap[String(leftOptId)] = matchId;
    setAnswers({ ...answers, [currentQuestion]: currentMap });
    setSelectedPoolMatchId(null);
    saveAnswerToDb(currentQuestion, currentMap);
  };

  const removeMatch = (leftOptId: string) => {
    const currentMap = { ...(answers[currentQuestion] || {}) };
    currentMap[String(leftOptId)] = '';
    setAnswers({ ...answers, [currentQuestion]: currentMap });
    saveAnswerToDb(currentQuestion, currentMap);
  };

  const handleSubmit = async () => {
    if (!user || !quizId || !attemptId) return;
    setIsSubmitting(true);

    try {
      // 1. Save current question answer just in case
      await saveAnswerToDb(currentQuestion, answers[currentQuestion]);

      let totalScore = 0;
      let maxScore = questions.length; // 1 point per question for now

      const processedAnswers = [];
      const hasAiQuestions = questions.some(q => q.type === 'text' || q.type === 'picture');

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const studentAnswer = answers[i];
        
        let score = 0;
        let isCorrect = false;

        let selectedOptionId: number | null = null;
        let textAnswer: string | null = null;

        if (q.type === 'single') {
          selectedOptionId = studentAnswer || null;
          const selectedOption = q.options.find(o => o.id === studentAnswer);
          if (selectedOption && selectedOption.isCorrect) {
            score = 1;
            isCorrect = true;
          }
          totalScore += score;
        } else if (q.type === 'multiple') {
          textAnswer = studentAnswer ? JSON.stringify(studentAnswer) : null;
          const studentSelections = studentAnswer || [];
          const correctOptionIds = q.options.filter(o => o.isCorrect).map(o => o.id);
          
          isCorrect = correctOptionIds.length === studentSelections.length &&
            correctOptionIds.every(id => studentSelections.includes(id));
          
          score = isCorrect ? 1 : 0;
          totalScore += score;
        } else if (q.type === 'text' || q.type === 'picture') {
          textAnswer = studentAnswer || '';
          // AI Graded, defaults to 0 score here
          score = 0;
          isCorrect = false;
        } else if (q.type === 'match') {
          textAnswer = studentAnswer ? JSON.stringify(studentAnswer) : null;
          const studentMatches = studentAnswer || {};
          let correctMatchesCount = 0;

          q.options.forEach((opt: any) => {
            const matchedId = studentMatches[String(opt.id)];
            if (String(matchedId) === String(opt.id)) {
              correctMatchesCount++;
            }
          });

          const points = Math.round(correctMatchesCount * 0.5);
          const maxPointsForQ = Math.round(q.options.length * 0.5);

          maxScore += (maxPointsForQ - 1);
          totalScore += points;
          score = points;
          isCorrect = correctMatchesCount === q.options.length;
        }

        processedAnswers.push({
          attempt_id: attemptId,
          question_id: q.id,
          selected_option_id: selectedOptionId,
          text_answer: textAnswer,
          ai_score: score,
          is_correct: isCorrect
        });
      }

      // Upsert all answers to DB (this updates their scored value)
      const { error: answersError } = await supabase
        .from('user_answers')
        .upsert(processedAnswers, { onConflict: 'attempt_id,question_id' });

      if (answersError) throw answersError;

      // Update Attempt to completed status
      const { error: attemptError } = await supabase
        .from('quiz_attempts')
        .update({
          score: Math.round(totalScore),
          max_score: Math.round(maxScore),
          is_graded: !hasAiQuestions,
          completed_at: new Date().toISOString()
        })
        .eq('id', attemptId);

      if (attemptError) throw attemptError;

      // Trigger asynchronous background grading if necessary
      if (hasAiQuestions) {
        gradeAttempt(attemptId).catch(e => {
          console.error("Error in background grading helper:", e);
        });
      }

      setIsSubmitted(true);
      toast.success('Quiz submitted successfully!');
    } catch (err: any) {
      toast.error('Failed to submit quiz: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <div className="text-center py-8">Loading quiz...</div>;
  if (questions.length === 0) return <div className="text-center py-8">No questions found for this quiz.</div>;

  const q = questions[currentQuestion];

  if (isSubmitted) {
    const hasAiQuestions = questions.some(q => q.type === 'text' || q.type === 'picture');
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl shadow-lg p-10 border border-blue-100">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle className="w-10 h-10 text-green-600" /></div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Quiz Completed!</h2>
          {hasAiQuestions ? (
            <p className="text-gray-600 text-md max-w-md mx-auto mt-4 font-medium">
              Your answers are submitted and are getting valuated. Please visit View Results in a few seconds to check your score.
            </p>
          ) : (
            <p className="text-gray-600 text-md max-w-md mx-auto mt-4 font-medium">
              Your answers have been graded and recorded.
            </p>
          )}
          <button onClick={() => navigate('/student')} className="mt-8 bg-blue-800 hover:bg-blue-900 text-white px-8 py-3 rounded-xl font-bold shadow-sm transition-all cursor-pointer">Return to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => navigate('/student')} className="text-gray-500 hover:text-gray-800 flex items-center text-sm font-medium"><XCircle className="w-5 h-5 mr-1" /> Exit Quiz</button>
        <div className="text-sm font-bold text-blue-800 bg-blue-100 px-3 py-1 rounded-full">Question {currentQuestion + 1} of {questions.length}</div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-blue-100 p-8 sm:p-10 mb-8">
        {q.imageUrl && (
          <div className="mb-6 rounded-2xl overflow-hidden border border-gray-200 shadow-sm max-h-[350px] flex justify-center bg-slate-50">
            <img src={q.imageUrl} alt="Question reference" className="max-h-[350px] object-contain rounded-2xl" />
          </div>
        )}
        <div className="mb-8 border-b border-gray-100 pb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">{q.textEn}</h2>
          {isBilingual && q.textTa && <h3 className="text-xl font-medium text-gray-500 font-serif">{q.textTa}</h3>}
        </div>
        
        <div className="space-y-4">
          {(q.type === 'single' || q.type === 'multiple') && q.options.map((opt: any, idx: any) => {
            const isSelected = q.type === 'multiple'
              ? (answers[currentQuestion] || []).includes(opt.id)
              : answers[currentQuestion] === opt.id;

            const handleOptionClick = () => {
              let newAnswer: any;
              if (q.type === 'single') {
                newAnswer = opt.id;
                setAnswers({ ...answers, [currentQuestion]: opt.id });
              } else {
                const currentSelections = answers[currentQuestion] || [];
                if (currentSelections.includes(opt.id)) {
                  newAnswer = currentSelections.filter((id: any) => id !== opt.id);
                  setAnswers({
                    ...answers,
                    [currentQuestion]: newAnswer
                  });
                } else {
                  newAnswer = [...currentSelections, opt.id];
                  setAnswers({
                    ...answers,
                    [currentQuestion]: newAnswer
                  });
                }
              }
              saveAnswerToDb(currentQuestion, newAnswer);
            };

            return (
              <div key={idx} onClick={handleOptionClick} className={`flex items-start p-5 rounded-2xl border-2 cursor-pointer transition-all ${isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}>
                <div className="flex items-center h-6 mr-4">
                  <input 
                    type={q.type === 'single' ? 'radio' : 'checkbox'} 
                    checked={isSelected} 
                    readOnly 
                    className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" 
                  />
                </div>
                <div className="flex-1">
                  <p className={`text-lg font-bold ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>{opt.en}</p>
                  {isBilingual && opt.ta && <p className={`text-md mt-1 font-serif ${isSelected ? 'text-blue-700' : 'text-gray-500'}`}>{opt.ta}</p>}
                </div>
              </div>
            );
          })}
          {(q.type === 'text' || q.type === 'picture') && (
            <textarea 
              className="w-full border-gray-300 border-2 rounded-2xl p-5 text-lg focus:ring-4 focus:border-blue-500" 
              rows={5} 
              placeholder="Type your answer here..." 
              value={answers[currentQuestion] || ''} 
              onChange={(e) => setAnswers({...answers, [currentQuestion]: e.target.value})}
              onBlur={() => saveAnswerToDb(currentQuestion, answers[currentQuestion])}
            ></textarea>
          )}
          {q.type === 'match' && (
            <div className="space-y-6">
              <p className="text-xs sm:text-sm font-bold text-blue-905 bg-blue-50 p-4 rounded-xl border border-blue-150 leading-relaxed">
                Drag a matching option from the pool at the bottom and drop it onto a left item's target slot. 
                On mobile/tablet, tap a match at the bottom first, then tap the target slot.
              </p>
              
              <div className="space-y-4">
                {q.options.map((opt: any) => {
                  const currentMap = answers[currentQuestion] || {};
                  const matchedId = currentMap[String(opt.id)] || '';
                  const matchedOpt = q.options.find((o: any) => String(o.id) === String(matchedId));

                  const handleSlotClick = () => {
                    if (selectedPoolMatchId) {
                      assignMatch(String(opt.id), selectedPoolMatchId);
                    }
                  };

                  return (
                    <div 
                      key={opt.id} 
                      className="flex flex-col md:flex-row items-stretch md:items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-gray-200"
                    >
                      {/* Left static item */}
                      <div className="flex-1">
                        <p className="text-lg font-bold text-gray-800">{opt.en}</p>
                        {isBilingual && opt.ta && <p className="text-sm mt-1 font-serif text-gray-500">{opt.ta}</p>}
                      </div>
                      
                      {/* Connector Arrow */}
                      <div className="hidden md:flex items-center text-gray-400">
                        <span className="text-xl">➔</span>
                      </div>
                      
                      {/* Dropzone / Target Slot */}
                      <div 
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDrop(e, String(opt.id))}
                        onClick={handleSlotClick}
                        className={`w-full md:w-80 min-h-[64px] border-2 border-dashed rounded-xl flex items-center justify-between p-3 transition-all ${
                          matchedOpt 
                            ? 'border-solid border-blue-500 bg-white shadow-sm' 
                            : selectedPoolMatchId 
                              ? 'border-blue-400 bg-blue-50/30 hover:bg-blue-50 cursor-pointer animate-pulse' 
                              : 'border-gray-300 bg-gray-50'
                        }`}
                      >
                        {matchedOpt ? (
                          <>
                            <div className="flex-1">
                              <p className="font-bold text-blue-900 text-sm sm:text-base">{matchedOpt.matchEn}</p>
                              {isBilingual && matchedOpt.matchTa && (
                                <p className="text-xs font-serif text-gray-500 mt-0.5">{matchedOpt.matchTa}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeMatch(String(opt.id));
                              }}
                              className="ml-2 text-gray-400 hover:text-red-500 text-lg font-bold w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                            >
                              ×
                            </button>
                          </>
                        ) : (
                          <div className="text-center w-full text-xs sm:text-sm text-gray-400 py-2">
                            {selectedPoolMatchId ? 'Tap here to place selected item' : 'Drag match here or tap to pair'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Shuffled Available Matches pool */}
              {(() => {
                const currentMap = answers[currentQuestion] || {};
                const assignedIds = Object.values(currentMap).filter(id => id !== '');
                const poolMatches = shuffledMatches.filter(m => !assignedIds.includes(String(m.id)));

                return (
                  <div className="mt-8 border-t border-gray-100 pt-6">
                    <h4 className="text-sm font-bold text-gray-700 mb-4">Available Matches (Pool):</h4>
                    <div className="flex flex-wrap gap-3">
                      {poolMatches.map((m: any) => {
                        const isSelected = String(m.id) === String(selectedPoolMatchId);
                        return (
                          <div
                            key={m.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, String(m.id))}
                            onClick={() => setSelectedPoolMatchId(isSelected ? null : String(m.id))}
                            className={`px-4 py-3 bg-white border-2 rounded-xl font-bold cursor-grab active:cursor-grabbing hover:bg-blue-50/50 hover:border-blue-300 transition-all select-none ${
                              isSelected ? 'border-blue-600 bg-blue-50 ring-4 ring-blue-50' : 'border-gray-200'
                            }`}
                          >
                            <div className="text-sm sm:text-base text-gray-800">{m.en}</div>
                            {isBilingual && m.ta && <div className="text-xs font-serif text-gray-500 font-normal mt-0.5">{m.ta}</div>}
                          </div>
                        );
                      })}
                      {poolMatches.length === 0 && (
                        <p className="text-sm italic text-gray-450">All matches assigned. Click any item's '×' button to reset it.</p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button 
          disabled={currentQuestion === 0 || isSubmitting} 
          onClick={async () => {
            await saveAnswerToDb(currentQuestion, answers[currentQuestion]);
            setCurrentQuestion((prev) => prev - 1);
          }} 
          className="px-6 py-3 rounded-xl font-bold text-sm bg-white border border-gray-300 text-gray-700 disabled:opacity-50"
        >
          Previous
        </button>
        {currentQuestion === questions.length - 1 ? (
          <button disabled={isSubmitting} onClick={handleSubmit} className="bg-green-600 text-white px-8 py-3 rounded-xl font-bold shadow-md disabled:opacity-50">
            {isSubmitting ? 'Grading & Submitting...' : 'Submit Quiz'}
          </button>
        ) : (
          <button 
            disabled={isSubmitting} 
            onClick={async () => {
              await saveAnswerToDb(currentQuestion, answers[currentQuestion]);
              setCurrentQuestion((prev) => prev + 1);
            }} 
            className="bg-blue-800 text-white px-8 py-3 rounded-xl font-bold shadow-sm"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
};
