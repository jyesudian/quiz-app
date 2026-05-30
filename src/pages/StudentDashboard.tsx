import { useState, useEffect } from 'react';
import { Book, Play, Trophy, Snowflake, UserPlus, Lock, Check, Share2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import type { QuizSeries } from '../types';

export const StudentDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [seriesData, setSeriesData] = useState<QuizSeries[]>([]);

  const fetchDashboardData = async () => {
    if (!user) return;
    try {
      const { data: seriesList, error: seriesError } = await supabase
        .from('quiz_series')
        .select(`*, series_enrollments(status, user_id)`)
        .order('created_at', { ascending: false });
      if (seriesError) throw seriesError;

      const { data: quizzesList, error: quizzesError } = await supabase
        .from('quizzes')
        .select('*')
        .eq('status', 'published');
      if (quizzesError) throw quizzesError;

      const { data: attemptsList, error: attemptsError } = await supabase
        .from('quiz_attempts')
        .select('quiz_id')
        .eq('user_id', user.id);
      if (attemptsError) throw attemptsError;
 
       const mappedSeries = (seriesList || []).map((s: any) => {
         const myEnrollment = (s.series_enrollments || []).find((e: any) => e.user_id === user.id);
         return {
           id: s.id,
           title: s.title,
           group: s.group_name || '',
           totalQuizzes: (quizzesList || []).filter((q: any) => q.series_id === s.id).length,
           isBilingual: s.is_bilingual,
           requiresApproval: s.requires_approval,
           isFrozen: s.is_frozen,
           enrolled: myEnrollment && myEnrollment.status === 'approved' ? [user.name] : [],
           isPending: myEnrollment && myEnrollment.status === 'pending',
           quizzes: (quizzesList || []).filter((q: any) => q.series_id === s.id).map((q: any) => ({
             id: q.id,
             title: q.title,
             isAttempted: (attemptsList || []).some((a: any) => a.quiz_id === q.id)
           }))
         };
       });

      setSeriesData(mappedSeries);
    } catch (err: any) {
      toast.error('Failed to fetch dashboard data');
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [user]);

  const handleJoin = async (series: QuizSeries) => {
    if (!user) return;
    try {
      const status = series.requiresApproval ? 'pending' : 'approved';
      const { error } = await supabase.from('series_enrollments').insert({
        series_id: series.id,
        user_id: user.id,
        status: status
      });
      if (error) throw error;
      toast.success(series.requiresApproval ? 'Request sent to admin' : 'Successfully joined!');
      fetchDashboardData();
    } catch (err: any) {
      toast.error('Error joining series: ' + err.message);
    }
  };

  const handleShare = async (quizId: number) => {
    const shareUrl = `${window.location.origin}/student/quiz/${quizId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Quiz link copied to clipboard!');
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  const enrolledSeries = seriesData.filter(s => s.enrolled.includes(user?.name || ''));
  const availableSeries = seriesData.filter(s => !s.enrolled.includes(user?.name || '') && !s.isFrozen);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-10 bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900">Welcome, {user?.name}</h1>
          <p className="text-gray-600 mt-2">Your faithful study journey continues.</p>
        </div>
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center"><Book className="mr-2 text-blue-600" /> My Active Studies</h2>
      
      {enrolledSeries.length === 0 ? (
         <div className="p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center text-gray-500 mb-10">You are not enrolled in any active series yet. Browse available series below.</div>
      ) : (
        enrolledSeries.map((series) => (
          <div key={series.id} className={`bg-white rounded-2xl shadow-md border overflow-hidden mb-8 ${series.isFrozen ? 'border-gray-200 opacity-90' : 'border-blue-200'}`}>
            <div className={`p-6 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${series.isFrozen ? 'bg-gradient-to-r from-gray-700 to-gray-600' : 'bg-gradient-to-r from-blue-900 to-blue-800'}`}>
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-2xl font-bold">{series.title}</h3>
                  {series.isFrozen && <span className="bg-white/20 text-white text-xs px-2 py-1 rounded font-bold flex items-center"><Snowflake size={12} className="mr-1"/> Concluded</span>}
                </div>
                <p className="text-white/80 text-sm mt-1 mb-3">{series.group} • {series.totalQuizzes} Quizzes Total</p>
                <button onClick={() => navigate(`/student/leaderboard/${series.id}`)} className="text-sm bg-white/10 hover:bg-white/20 text-white py-1.5 px-3 rounded inline-flex items-center transition-colors border border-white/20">
                  <Trophy size={14} className="mr-2 text-yellow-400" /> View {series.isFrozen ? 'Final' : 'Series'} Leaderboard
                </button>
              </div>
            </div>
            
            {!series.isFrozen && (
              <div className="p-5 bg-white border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Available Quizzes</h4>
                <div className="space-y-3">
                  {series.quizzes && series.quizzes.length > 0 ? (
                    series.quizzes.map((quiz) => (
                      <div key={quiz.id} className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/20 transition-all">
                        <div className="flex items-center">
                          {quiz.isAttempted ? (
                            <div className="h-5 w-5 rounded-full bg-green-100 border-2 border-green-500 mr-3 flex items-center justify-center"><Check className="h-3 w-3 text-green-600 font-extrabold" /></div>
                          ) : (
                            <div className="h-5 w-5 rounded-full border-2 border-blue-500 mr-3 flex items-center justify-center"><div className="h-1.5 w-1.5 bg-blue-500 rounded-full"></div></div>
                          )}
                          <span className={`font-bold ${quiz.isAttempted ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{quiz.title}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {quiz.isAttempted ? (
                            <div className="flex items-center gap-2">
                              <span className="bg-green-50 text-green-700 text-xs px-3 py-1.5 rounded-lg font-bold border border-green-200">Completed</span>
                              <button onClick={() => navigate(`/quiz-results/${quiz.id}`)} className="bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs px-3 py-1.5 rounded-lg font-bold border border-blue-200 transition-colors cursor-pointer">
                                View Results
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => navigate(`/student/quiz/${quiz.id}`)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center">
                              <Play size={12} className="mr-1.5 fill-current" /> Take Quiz
                            </button>
                          )}
                          <button 
                            onClick={() => handleShare(quiz.id)}
                            title="Share Quiz Link"
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            <Share2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-400 italic">No quizzes available for this series yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}

      <h2 className="text-xl font-bold text-gray-900 mb-6 mt-12 flex items-center border-t pt-8"><UserPlus className="mr-2 text-blue-600" /> Explore & Join Series</h2>
      {availableSeries.length === 0 ? (
        <div className="p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center text-gray-500 font-medium">
          No new quizzes available.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           {availableSeries.map((series) => (
              <div key={series.id} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                 <h3 className="text-lg font-bold text-blue-900">{series.title}</h3>
                 <p className="text-sm text-gray-500 mt-1">{series.group}</p>
                 <div className="mt-4 flex items-center gap-2 mb-6">
                    {series.requiresApproval ? <span className="bg-amber-50 text-amber-700 text-xs px-2 py-1 rounded font-bold border border-amber-200 flex items-center"><Lock size={12} className="mr-1"/> Request Required</span> : <span className="bg-green-50 text-green-700 text-xs px-2 py-1 rounded font-bold border border-green-200">Open Access</span>}
                 </div>
                 <button 
                   disabled={series.isPending}
                   onClick={() => handleJoin(series)}
                   className={`w-full py-2 rounded-lg font-bold text-sm transition-colors ${
                     series.isPending
                       ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                       : series.requiresApproval
                         ? 'bg-white border border-blue-600 text-blue-700 hover:bg-blue-50'
                         : 'bg-blue-600 text-white hover:bg-blue-700'
                   }`}
                 >
                    {series.isPending ? 'Request Pending' : series.requiresApproval ? 'Request Access' : 'Unlock / Join Instantly'}
                 </button>
              </div>
           ))}
        </div>
      )}
    </div>
  );
};
