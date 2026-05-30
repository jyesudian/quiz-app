import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Trophy, Download, CheckCircle, XCircle, Info, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import { jsPDF } from 'jspdf';

interface Option {
  id: number;
  en: string;
  ta: string;
  isCorrect: boolean;
}

interface Question {
  id: number;
  type: string;
  textEn: string;
  textTa: string;
  aiRubric: string;
  options: Option[];
}

interface UserAnswer {
  question_id: number;
  selected_option_id: number | null;
  text_answer: string | null;
  ai_score: number;
  is_correct: boolean;
}

export const QuizResults: React.FC = () => {
  const { quizId, userId } = useParams<{ quizId: string; userId?: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [quiz, setQuiz] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<UserAnswer[]>([]);
  const [rank, setRank] = useState<string>('N/A');
  const [studentProfile, setStudentProfile] = useState<any>(null);

  // Determine whose results we are viewing
  const targetUserId = userId || currentUser?.id;

  useEffect(() => {
    const fetchResults = async () => {
      if (!targetUserId || !quizId) return;

      try {
        setIsLoading(true);

        // 1. Fetch Student Profile (needed for name/email if viewing another student or for report details)
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', targetUserId)
          .single();

        if (profileError) throw profileError;
        setStudentProfile(profileData);

        // 2. Fetch Quiz metadata (and Series title)
        const { data: quizData, error: quizError } = await supabase
          .from('quizzes')
          .select(`*, quiz_series(*)`)
          .eq('id', quizId)
          .single();

        if (quizError) throw quizError;
        setQuiz(quizData);

        // 3. Fetch user's latest attempt for this quiz
        const { data: attemptData, error: attemptError } = await supabase
          .from('quiz_attempts')
          .select('*')
          .eq('quiz_id', quizId)
          .eq('user_id', targetUserId)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (attemptError) throw attemptError;
        if (!attemptData) {
          toast.error('No attempt records found for this quiz.');
          navigate(-1);
          return;
        }
        setAttempt(attemptData);

        // 4. Fetch questions and options
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
            aiRubric: q.ai_rubric || '',
            options: (q.question_options || []).map((opt: any) => ({
              id: opt.id,
              en: opt.text_en,
              ta: opt.text_ta || '',
              isCorrect: opt.is_correct
            }))
          }));
          setQuestions(mappedQuestions);
        }

        // 5. Fetch user's answers for this attempt
        const { data: answersData, error: aError } = await supabase
          .from('user_answers')
          .select('*')
          .eq('attempt_id', attemptData.id);

        if (aError) throw aError;
        setAnswers(answersData || []);

        // 6. Fetch overall rank from the series leaderboard
        if (quizData.series_id) {
          const { data: leaderboardData, error: rpcError } = await supabase.rpc('get_series_leaderboard', {
            series_id_param: quizData.series_id
          });

          if (!rpcError && leaderboardData) {
            const userEntry = leaderboardData.find((entry: any) => entry.user_id === targetUserId);
            if (userEntry) {
              setRank(`#${userEntry.rank}`);
            }
          }
        }
      } catch (err: any) {
        console.error('Error fetching quiz results:', err);
        toast.error('Failed to load quiz results details.');
        navigate(-1);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [quizId, targetUserId, navigate]);

  const handleDownloadPDF = () => {
    if (!quiz || !attempt || !studentProfile) return;
    setIsDownloading(true);

    try {
      const doc = new jsPDF();
      let yOffset = 20;

      // Header Banner
      doc.setFillColor(30, 41, 59); // Slate-800
      doc.rect(0, 0, 210, 30, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(22);
      doc.text("Da'at - Quiz Portal", 14, 20);

      yOffset = 42;

      // Report Title
      doc.setTextColor(15, 23, 42); // slate-900
      doc.setFontSize(16);
      doc.text('Quiz Grading & Answer Key Report', 14, yOffset);
      yOffset += 10;

      // Quiz Details
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.5);
      doc.line(14, yOffset, 196, yOffset);
      yOffset += 8;

      // Metadata block (Left Column)
      doc.setFontSize(10);
      doc.setFont('Helvetica', 'bold');
      doc.text('Student:', 14, yOffset);
      doc.setFont('Helvetica', 'normal');
      doc.text(studentProfile.full_name || 'N/A', 40, yOffset);

      doc.setFont('Helvetica', 'bold');
      doc.text('Quiz:', 14, yOffset + 6);
      doc.setFont('Helvetica', 'normal');
      doc.text(quiz.title || 'N/A', 40, yOffset + 6);

      doc.setFont('Helvetica', 'bold');
      doc.text('Series:', 14, yOffset + 12);
      doc.setFont('Helvetica', 'normal');
      doc.text(quiz.quiz_series?.title || 'N/A', 40, yOffset + 12);

      // Metadata block (Right Column)
      doc.setFont('Helvetica', 'bold');
      doc.text('Score:', 120, yOffset);
      doc.setFont('Helvetica', 'normal');
      doc.text(`${attempt.score} / ${attempt.max_score} (${Math.round((attempt.score / attempt.max_score) * 100)}%)`, 150, yOffset);

      doc.setFont('Helvetica', 'bold');
      doc.text('Completed At:', 120, yOffset + 6);
      doc.setFont('Helvetica', 'normal');
      doc.text(new Date(attempt.completed_at).toLocaleDateString(), 150, yOffset + 6);

      doc.setFont('Helvetica', 'bold');
      doc.text('Overall Rank:', 120, yOffset + 12);
      doc.setFont('Helvetica', 'normal');
      doc.text(rank || 'N/A', 150, yOffset + 12);

      yOffset += 24;
      doc.line(14, yOffset, 196, yOffset);
      yOffset += 10;

      // Individual Question Grading
      doc.setFontSize(13);
      doc.setFont('Helvetica', 'bold');
      doc.text('Question Breakdown (English translation)', 14, yOffset);
      yOffset += 8;

      questions.forEach((question, index) => {
        const studentAns = answers.find(ans => ans.question_id === question.id);
        
        // Check Page Boundaries
        if (yOffset > 250) {
          doc.addPage();
          yOffset = 20;
        }

        doc.setFontSize(11);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(15, 23, 42); // slate-900
        
        // Wrap text to avoid overflow
        const questionLines = doc.splitTextToSize(`Q${index + 1}. ${question.textEn}`, 175);
        doc.text(questionLines, 14, yOffset);
        yOffset += (questionLines.length * 5) + 2;

        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(10);

        if (question.type === 'single' || question.type === 'multiple') {
          question.options.forEach((opt) => {
            if (yOffset > 270) {
              doc.addPage();
              yOffset = 20;
            }

            let isSelected = false;
            if (question.type === 'single') {
              isSelected = studentAns?.selected_option_id === opt.id;
            } else {
              let selectedIds: number[] = [];
              try {
                selectedIds = JSON.parse(studentAns?.text_answer || '[]');
              } catch {
                selectedIds = [];
              }
              isSelected = selectedIds.includes(opt.id);
            }

            const isOptCorrect = opt.isCorrect;

            let prefix = '[ ] ';
            if (isSelected) {
              prefix = '[x] ';
            }

            let suffix = '';
            if (isOptCorrect) {
              suffix = ' (Correct)';
              doc.setTextColor(22, 101, 52); // green-800
              doc.setFont('Helvetica', 'bold');
            } else if (isSelected && !isOptCorrect) {
              suffix = ' (Incorrect)';
              doc.setTextColor(153, 27, 27); // red-800
              doc.setFont('Helvetica', 'bold');
            } else {
              doc.setTextColor(71, 85, 105); // slate-600
              doc.setFont('Helvetica', 'normal');
            }

            const optionLines = doc.splitTextToSize(`${prefix}${opt.en}${suffix}`, 170);
            doc.text(optionLines, 18, yOffset);
            yOffset += (optionLines.length * 5);
          });
          yOffset += 2;
        } else if (question.type === 'text') {
          const wrappedAns = doc.splitTextToSize(`Your Answer: ${studentAns?.text_answer || 'Unanswered'}`, 170);
          doc.text(wrappedAns, 18, yOffset);
          yOffset += (wrappedAns.length * 5);

          const wrappedRubric = doc.splitTextToSize(`Correct Answer Criteria: ${question.aiRubric || 'N/A'}`, 170);
          doc.text(wrappedRubric, 18, yOffset);
          yOffset += (wrappedRubric.length * 5);
        }

        // Score Status
        const pointsAwarded = studentAns ? studentAns.ai_score : 0;
        const maxPoints = question.type === 'text' ? 2 : 1;
        const isCorrect = studentAns ? studentAns.is_correct : false;

        doc.setFont('Helvetica', 'bold');
        if (isCorrect || (question.type === 'text' && pointsAwarded === 2)) {
          doc.setTextColor(22, 101, 52); // green-800
          doc.text(`Grading: Correct (${pointsAwarded}/${maxPoints} pts)`, 18, yOffset);
        } else if (pointsAwarded > 0) {
          doc.setTextColor(146, 64, 14); // amber-800
          doc.text(`Grading: Partially Correct (${pointsAwarded}/${maxPoints} pts)`, 18, yOffset);
        } else {
          doc.setTextColor(153, 27, 27); // red-800
          doc.text(`Grading: Incorrect (${pointsAwarded}/${maxPoints} pts)`, 18, yOffset);
        }
        
        yOffset += 8;
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.line(14, yOffset, 196, yOffset);
        yOffset += 6;
      });

      doc.save(`Quiz_Grading_Report_${quiz.title.replace(/\s+/g, '_')}.pdf`);
      toast.success('PDF report downloaded successfully!');
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('Failed to generate PDF report.');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-blue-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-900 mb-4"></div>
        <p className="font-bold">Fetching corrected answers & grading...</p>
      </div>
    );
  }

  const percentage = attempt ? Math.round((attempt.score / attempt.max_score) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Navigation */}
      <button
        onClick={() => navigate(-1)}
        className="text-blue-600 hover:text-blue-800 mb-6 flex items-center text-sm font-bold transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </button>

      {/* Main Header / Banner */}
      <div className="bg-gradient-to-r from-blue-950 to-blue-900 text-white rounded-3xl shadow-xl p-8 mb-8 relative overflow-hidden border border-blue-800">
        <div className="absolute right-0 top-0 opacity-10 transform translate-x-10 -translate-y-10">
          <Trophy size={200} />
        </div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <span className="bg-blue-800 text-blue-100 font-bold text-xs uppercase px-3 py-1 rounded-full tracking-wider">
              {quiz?.quiz_series?.title || 'Study Series'}
            </span>
            <h1 className="text-3xl font-extrabold mt-2 tracking-tight">{quiz?.title}</h1>
            <p className="text-blue-200 text-sm mt-1">
              Results for {studentProfile?.full_name} • Attempted on {new Date(attempt?.completed_at).toLocaleDateString()}
            </p>
          </div>

          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md disabled:opacity-50 cursor-pointer"
          >
            <Download size={18} />
            {isDownloading ? 'Generating PDF...' : 'Download PDF Report'}
          </button>
        </div>
      </div>

      {/* Score Grid & Rank Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Score Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider">Overall Score</h3>
            <p className="text-3xl font-black text-blue-900 mt-2">
              {attempt?.score} <span className="text-lg text-gray-400">/ {attempt?.max_score}</span>
            </p>
          </div>
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-800 font-extrabold text-lg">
            {percentage}%
          </div>
        </div>

        {/* Rank Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider">Series Rank</h3>
            <p className="text-3xl font-black text-amber-600 mt-2">{rank}</p>
          </div>
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center text-amber-600">
            <Trophy size={28} />
          </div>
        </div>
      </div>

      {/* Corrected Answers Section */}
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
        <Award className="mr-2 text-blue-700" /> Corrected Answers & Grading
      </h2>

      <div className="space-y-6">
        {questions.map((question, index) => {
          const studentAns = answers.find(ans => ans.question_id === question.id);
          const pointsAwarded = studentAns ? studentAns.ai_score : 0;
          const maxPoints = question.type === 'text' ? 2 : 1;
          const isCorrect = studentAns ? studentAns.is_correct : false;

          // Determine Card Styles based on correctness
          let borderStyle = 'border-gray-200';
          let badgeStyle = 'bg-gray-100 text-gray-800';
          let statusText = 'Unanswered';

          if (studentAns) {
            if (isCorrect || (question.type === 'text' && pointsAwarded === 2)) {
              borderStyle = 'border-green-300 bg-green-50/10';
              badgeStyle = 'bg-green-100 text-green-800';
              statusText = 'Correct';
            } else if (pointsAwarded > 0) {
              borderStyle = 'border-amber-300 bg-amber-50/10';
              badgeStyle = 'bg-amber-100 text-amber-800';
              statusText = 'Partially Correct';
            } else {
              borderStyle = 'border-red-300 bg-red-50/10';
              badgeStyle = 'bg-red-100 text-red-800';
              statusText = 'Incorrect';
            }
          }

          const hasTamilText = question.textTa && question.textTa.trim() !== '';

          return (
            <div key={question.id} className={`bg-white rounded-2xl border-2 shadow-sm p-6 sm:p-8 transition-all ${borderStyle}`}>
              {/* Question Header */}
              <div className="flex justify-between items-start gap-4 mb-4 border-b border-slate-100 pb-4">
                <div className="flex-1">
                  <span className="font-bold text-blue-900 mr-2 text-lg">Question {index + 1}</span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeStyle}`}>
                    {statusText}
                  </span>
                </div>
                <div className="text-sm font-bold text-gray-500 whitespace-nowrap">
                  {pointsAwarded} / {maxPoints} pts
                </div>
              </div>

              {/* Question Body */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">{question.textEn}</h3>
                {hasTamilText && (
                  <h4 className="text-base font-medium text-gray-500 font-serif mt-2 leading-relaxed">
                    {question.textTa}
                  </h4>
                )}
              </div>

              {/* Answer options / input display */}
              <div className="space-y-3">
                {/* SINGLE / MULTIPLE CHOICE */}
                {(question.type === 'single' || question.type === 'multiple') && question.options.map((opt) => {
                  let isSelected = false;
                  if (question.type === 'single') {
                    isSelected = studentAns?.selected_option_id === opt.id;
                  } else {
                    let selectedIds: number[] = [];
                    try {
                      selectedIds = JSON.parse(studentAns?.text_answer || '[]');
                    } catch {
                      selectedIds = [];
                    }
                    isSelected = selectedIds.includes(opt.id);
                  }

                  const isOptCorrect = opt.isCorrect;

                  let optBorder = 'border-gray-200';
                  let optBg = 'bg-white';
                  let optIcon = null;

                  if (isOptCorrect) {
                    optBorder = 'border-green-500 bg-green-50/50';
                    optBg = 'bg-green-50/20';
                    optIcon = <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />;
                  } else if (isSelected && !isOptCorrect) {
                    optBorder = 'border-red-500 bg-red-50/50';
                    optBg = 'bg-red-50/20';
                    optIcon = <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />;
                  }

                  return (
                    <div
                      key={opt.id}
                      className={`flex items-start justify-between p-4 rounded-xl border-2 transition-all ${optBorder} ${optBg}`}
                    >
                      <div className="flex-1 mr-4">
                        <p className={`font-bold text-sm sm:text-base ${isSelected ? 'text-blue-950 font-black' : 'text-gray-700'}`}>
                          {opt.en}
                        </p>
                        {opt.ta && (
                          <p className="text-xs sm:text-sm text-gray-500 font-serif mt-1">
                            {opt.ta}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="text-xs font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full">
                            Your Selection
                          </span>
                        )}
                        {optIcon}
                      </div>
                    </div>
                  );
                })}

                {/* TEXT / AI QUESTION */}
                {question.type === 'text' && (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Your Submission</h4>
                      <p className="text-gray-800 leading-relaxed whitespace-pre-line text-sm sm:text-base">
                        {studentAns?.text_answer || <span className="italic text-gray-400">Unanswered</span>}
                      </p>
                    </div>

                    {question.aiRubric && (
                      <div className="p-4 bg-blue-50/30 border border-blue-100 rounded-xl flex items-start gap-3">
                        <Info className="w-5 h-5 text-blue-700 mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1">Correct Answer Criteria / Rubric</h4>
                          <p className="text-blue-900 leading-relaxed text-sm">
                            {question.aiRubric}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
