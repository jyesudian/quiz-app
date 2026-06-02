import { useState, useEffect } from 'react';
import { XCircle, CheckCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import type { Question } from '../types';

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
  
  // Assume bilingual if any question has Tamil text
  const isBilingual = questions.some(q => q.textTa && q.textTa.trim() !== '');

  useEffect(() => {
    const fetchQuiz = async () => {
      if (!user || !quizId) return;
      try {
        // Check if user already completed this quiz
        const { data: existingAttempt, error: attemptCheckError } = await supabase
          .from('quiz_attempts')
          .select('id')
          .eq('quiz_id', quizId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (attemptCheckError) {
          console.error('Error checking attempts:', attemptCheckError);
        }

        if (existingAttempt) {
          toast.error('You have already completed this quiz!');
          navigate('/student');
          return;
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
  };

  const removeMatch = (leftOptId: string) => {
    const currentMap = { ...(answers[currentQuestion] || {}) };
    currentMap[String(leftOptId)] = '';
    setAnswers({ ...answers, [currentQuestion]: currentMap });
  };

  const handleSubmit = async () => {
    if (!user || !quizId) return;
    setIsSubmitting(true);

    try {
      let totalScore = 0;
      let maxScore = questions.length; // 1 point per question for now

      const processedAnswers = [];

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const studentAnswer = answers[i];
        
        let score = 0;
        let isCorrect = false;

        if (q.type === 'single') {
          const selectedOption = q.options.find(o => o.id === studentAnswer);
          if (selectedOption && selectedOption.isCorrect) {
            score = 1;
            isCorrect = true;
          }
          processedAnswers.push({
            question_id: q.id,
            selected_option_id: studentAnswer || null,
            text_answer: null,
            ai_score: score,
            is_correct: isCorrect
          });
          totalScore += score;
        } else if (q.type === 'multiple') {
          const studentSelections = studentAnswer || []; // Array of option IDs
          const correctOptionIds = q.options.filter(o => o.isCorrect).map(o => o.id);
          
          isCorrect = correctOptionIds.length === studentSelections.length &&
            correctOptionIds.every(id => studentSelections.includes(id));
          
          score = isCorrect ? 1 : 0;
          
          processedAnswers.push({
            question_id: q.id,
            selected_option_id: null,
            text_answer: JSON.stringify(studentSelections),
            ai_score: score,
            is_correct: isCorrect
          });
          totalScore += score;
        } else if (q.type === 'text') {
          // Call Edge Function for AI Grading
          let aiScore = 0;
          try {
            const { data, error } = await supabase.functions.invoke('grade-answer', {
              body: {
                studentAnswer: studentAnswer || '',
                aiRubric: q.aiRubric,
                questionEn: q.textEn
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
                points = 0.5;
              }
              // Since maxScore initialized to questions.length (adds 1 point per question),
              // we add 1 more point to make the max score for this text question 2.
              maxScore += 1;
              totalScore += points;
              aiScore = points;
            }
          } catch (aiErr) {
            console.error('AI Grading failed for question', q.id, aiErr);
            // Default to 0 if fails
          }

          processedAnswers.push({
            question_id: q.id,
            selected_option_id: null,
            text_answer: studentAnswer || '',
            ai_score: aiScore,
            is_correct: aiScore === 2
          });
        } else if (q.type === 'match') {
          const studentMatches = answers[i] || {};
          let correctMatchesCount = 0;

          q.options.forEach((opt: any) => {
            const matchedId = studentMatches[String(opt.id)];
            if (String(matchedId) === String(opt.id)) {
              correctMatchesCount++;
            }
          });

          const points = correctMatchesCount * 0.5;
          const maxPointsForQ = q.options.length * 0.5;

          // Adjust max score for this question (questions.length initially assumed 1 point, so we add the difference)
          maxScore += (maxPointsForQ - 1);
          totalScore += points;

          processedAnswers.push({
            question_id: q.id,
            selected_option_id: null,
            text_answer: JSON.stringify(studentMatches),
            ai_score: points,
            is_correct: correctMatchesCount === q.options.length
          });
        }
      }

      // Insert Attempt
      const { data: attemptData, error: attemptError } = await supabase
        .from('quiz_attempts')
        .insert({
          quiz_id: parseInt(quizId),
          user_id: user.id,
          score: totalScore,
          max_score: maxScore,
          completed_at: new Date().toISOString()
        })
        .select()
        .single();

      if (attemptError) throw attemptError;

      // Insert Answers
      const answersToInsert = processedAnswers.map(pa => ({
        ...pa,
        attempt_id: attemptData.id
      }));

      const { error: answersError } = await supabase
        .from('user_answers')
        .insert(answersToInsert);

      if (answersError) throw answersError;

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
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl shadow-lg p-10 border border-blue-100">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle className="w-10 h-10 text-green-600" /></div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Quiz Completed!</h2>
          <button onClick={() => navigate('/student')} className="mt-8 bg-blue-800 hover:bg-blue-900 text-white px-8 py-3 rounded-xl font-bold shadow-sm transition-all">Return to Dashboard</button>
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
              if (q.type === 'single') {
                setAnswers({ ...answers, [currentQuestion]: opt.id });
              } else {
                const currentSelections = answers[currentQuestion] || [];
                if (currentSelections.includes(opt.id)) {
                  setAnswers({
                    ...answers,
                    [currentQuestion]: currentSelections.filter((id: any) => id !== opt.id)
                  });
                } else {
                  setAnswers({
                    ...answers,
                    [currentQuestion]: [...currentSelections, opt.id]
                  });
                }
              }
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
          {q.type === 'text' && (
            <textarea className="w-full border-gray-300 border-2 rounded-2xl p-5 text-lg focus:ring-4 focus:border-blue-500" rows={5} placeholder="Type your answer here..." value={answers[currentQuestion] || ''} onChange={(e) => setAnswers({...answers, [currentQuestion]: e.target.value})}></textarea>
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
        <button disabled={currentQuestion === 0 || isSubmitting} onClick={() => setCurrentQuestion((prev) => prev - 1)} className="px-6 py-3 rounded-xl font-bold text-sm bg-white border border-gray-300 text-gray-700 disabled:opacity-50">Previous</button>
        {currentQuestion === questions.length - 1 ? (
          <button disabled={isSubmitting} onClick={handleSubmit} className="bg-green-600 text-white px-8 py-3 rounded-xl font-bold shadow-md disabled:opacity-50">
            {isSubmitting ? 'Grading & Submitting...' : 'Submit Quiz'}
          </button>
        ) : (
          <button disabled={isSubmitting} onClick={() => setCurrentQuestion((prev) => prev + 1)} className="bg-blue-800 text-white px-8 py-3 rounded-xl font-bold shadow-sm">Next</button>
        )}
      </div>
    </div>
  );
};
