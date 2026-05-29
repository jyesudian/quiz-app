import { useState, useEffect, Fragment } from 'react';
import { Plus, List, Trophy, UserPlus, Lock, Snowflake, Users, Edit3, Share2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import type { QuizSeries, Quiz, EnrollmentRequest } from '../types';

export const AdminDashboard = () => {
  const [adminTab, setAdminTab] = useState('overview'); 
  const [seriesData, setSeriesData] = useState<QuizSeries[]>([]);
  const [quizDataState, setQuizDataState] = useState<Quiz[]>([]);
  const [pendingRequests, setPendingRequests] = useState<EnrollmentRequest[]>([]);
  const [adminLeaderboardSeriesId, setAdminLeaderboardSeriesId] = useState<string>('');
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedBreakdown, setExpandedBreakdown] = useState<any[]>([]);
  const [isBreakdownLoading, setIsBreakdownLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      if (!adminLeaderboardSeriesId) return;
      setIsLeaderboardLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_series_leaderboard', {
          series_id_param: parseInt(adminLeaderboardSeriesId)
        });
        if (error) throw error;
        setLeaderboardData(data || []);
      } catch (err) {
        console.error('Error fetching leaderboard:', err);
        toast.error('Failed to load leaderboard rankings');
        setLeaderboardData([]);
      } finally {
        setIsLeaderboardLoading(false);
      }
    };

    if (adminTab === 'leaderboard' && adminLeaderboardSeriesId) {
      fetchLeaderboard();
    }
  }, [adminLeaderboardSeriesId, adminTab]);

  useEffect(() => {
    setExpandedUserId(null);
    setExpandedBreakdown([]);
  }, [adminLeaderboardSeriesId, adminTab]);

  const handleRowClick = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }

    setExpandedUserId(userId);
    setIsBreakdownLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_user_series_attempts', {
        series_id_param: parseInt(adminLeaderboardSeriesId || '0'),
        user_id_param: userId
      });
      if (error) throw error;
      setExpandedBreakdown(data || []);
    } catch (err) {
      console.error('Error fetching breakdown:', err);
      toast.error('Failed to load quiz breakdown');
      setExpandedBreakdown([]);
    } finally {
      setIsBreakdownLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { data: seriesList, error: seriesError } = await supabase
        .from('quiz_series')
        .select(`*, series_enrollments(status, profiles(full_name, email))`)
        .order('created_at', { ascending: false });
      if (seriesError) throw seriesError;

      const { data: quizzesList, error: quizzesError } = await supabase
        .from('quizzes')
        .select('*')
        .order('created_at', { ascending: false });
      if (quizzesError) throw quizzesError;

      const { data: enrollmentsList, error: enrollmentsError } = await supabase
        .from('series_enrollments')
        .select(`id, series_id, created_at, profiles(full_name, email), quiz_series(title)`)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (enrollmentsError) throw enrollmentsError;

      const mappedSeries = (seriesList || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        group: s.group_name || '',
        totalQuizzes: (quizzesList || []).filter((q: any) => q.series_id === s.id).length,
        isBilingual: s.is_bilingual,
        requiresApproval: s.requires_approval,
        isFrozen: s.is_frozen,
        enrolled: (s.series_enrollments || [])
          .filter((e: any) => e.status === 'approved')
          .map((e: any) => e.profiles?.full_name || e.profiles?.email || 'Unknown Student')
      }));

      const mappedQuizzes = (quizzesList || []).map((q: any) => ({
        id: q.id,
        seriesId: q.series_id,
        title: q.title,
        status: q.status
      }));

      const mappedRequests = (enrollmentsList || []).map((e: any) => ({
        id: e.id,
        studentName: e.profiles?.full_name || e.profiles?.email || 'Unknown Student',
        seriesId: e.series_id,
        seriesName: e.quiz_series?.title || 'Unknown Series',
        date: e.created_at ? new Date(e.created_at).toLocaleDateString() : 'Just now'
      }));

      setSeriesData(mappedSeries);
      setQuizDataState(mappedQuizzes);
      setPendingRequests(mappedRequests);

      if (mappedSeries.length > 0 && !adminLeaderboardSeriesId) {
        setAdminLeaderboardSeriesId(mappedSeries[0].id.toString());
      }
    } catch (err: any) {
      toast.error('Failed to load dashboard data');
      console.error(err);
    }
  };

  const toggleFreeze = async (id: number, currentIsFrozen: boolean) => {
    try {
      const { error } = await supabase.from('quiz_series').update({ is_frozen: !currentIsFrozen }).eq('id', id);
      if (error) throw error;
      setSeriesData(seriesData.map(s => s.id === id ? { ...s, isFrozen: !currentIsFrozen } : s));
      toast.success(currentIsFrozen ? 'Series unfrozen' : 'Series frozen');
    } catch (err: any) {
      toast.error('Error updating freeze state');
    }
  };

  const handleApprove = async (reqId: number, studentName: string, seriesId: number) => {
    try {
      const { error } = await supabase.from('series_enrollments').update({ status: 'approved' }).eq('id', reqId);
      if (error) throw error;
      setSeriesData(seriesData.map(s => s.id === seriesId ? { ...s, enrolled: [...s.enrolled, studentName] } : s));
      setPendingRequests(pendingRequests.filter(r => r.id !== reqId));
      toast.success('Enrollment approved');
    } catch (err: any) {
      toast.error('Error approving request');
    }
  };

  const handleReject = async (reqId: number) => {
    try {
      const { error } = await supabase.from('series_enrollments').update({ status: 'rejected' }).eq('id', reqId);
      if (error) throw error;
      setPendingRequests(pendingRequests.filter(r => r.id !== reqId));
      toast.success('Enrollment rejected');
    } catch (err: any) {
      toast.error('Error rejecting request');
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">Manage quiz series, evaluate AI scoring, and view leaderboards.</p>
        </div>
        <button onClick={() => navigate('/admin/create-quiz')} className="bg-blue-800 hover:bg-blue-900 text-white px-6 py-2.5 rounded-xl font-bold shadow-sm transition-all flex items-center">
          <Plus size={18} className="mr-2" /> Create New Quiz
        </button>
      </div>

      <div className="flex space-x-1 border-b border-gray-200 mb-8 overflow-x-auto">
        <button onClick={() => setAdminTab('overview')} className={`py-3 px-6 text-sm font-bold border-b-2 whitespace-nowrap flex items-center ${adminTab === 'overview' ? 'border-blue-800 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><List size={16} className="mr-2"/> Series Overview</button>
        <button onClick={() => setAdminTab('leaderboard')} className={`py-3 px-6 text-sm font-bold border-b-2 whitespace-nowrap flex items-center ${adminTab === 'leaderboard' ? 'border-blue-800 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Trophy size={16} className="mr-2"/> Leaderboards</button>
        <button onClick={() => setAdminTab('requests')} className={`py-3 px-6 text-sm font-bold border-b-2 whitespace-nowrap flex items-center ${adminTab === 'requests' ? 'border-blue-800 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><UserPlus size={16} className="mr-2"/> Enrollment Requests {pendingRequests.length > 0 && <span className="ml-2 bg-blue-100 text-blue-800 py-0.5 px-2 rounded-full text-xs">{pendingRequests.length}</span>}</button>
      </div>

      {adminTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-900">Active & Completed Series</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {seriesData.map((series) => (
                  <div key={series.id} className={`p-6 transition-colors ${series.isFrozen ? 'bg-slate-50' : 'hover:bg-gray-50'}`}>
                     <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <h3 className={`text-lg font-bold ${series.isFrozen ? 'text-gray-600' : 'text-blue-900'}`}>{series.title}</h3>
                          {series.isBilingual && <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded font-bold">EN/TA</span>}
                          {series.requiresApproval ? <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded font-bold flex items-center"><Lock size={10} className="mr-1"/> Approval Required</span> : <span className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded font-bold">Open Access</span>}
                          {series.isFrozen && <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded font-bold flex items-center"><Snowflake size={10} className="mr-1"/> Concluded</span>}
                        </div>
                        <p className="text-sm text-gray-500 flex items-center"><Users size={14} className="mr-1" /> {series.group} • {series.enrolled.length} Enrolled</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-gray-700">{series.totalQuizzes} Quizzes</span>
                      </div>
                    </div>
                    <div className="flex space-x-3 border-t border-gray-100 pt-3">
                      <button onClick={() => toggleFreeze(series.id, series.isFrozen)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${series.isFrozen ? 'border-blue-300 text-blue-700 hover:bg-blue-50' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>
                        {series.isFrozen ? 'Unfreeze Series' : 'Freeze / Conclude Series'}
                      </button>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quizzes in Series</h4>
                      <div className="space-y-2">
                        {quizDataState.filter((q) => q.seriesId === series.id).map((quiz) => (
                          <div key={quiz.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:border-blue-300 transition-colors">
                            <div>
                              <span className="text-sm font-bold text-gray-800">{quiz.title}</span>
                              <span className={`ml-3 text-xs px-2 py-0.5 rounded-full font-bold ${quiz.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{quiz.status === 'published' ? 'Published' : 'Draft'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {quiz.status === 'published' && (
                                <button 
                                  onClick={() => handleShare(quiz.id)}
                                  title="Share Quiz Link"
                                  className="text-gray-500 hover:text-blue-600 hover:bg-blue-50 p-1.5 rounded transition-colors flex items-center text-xs font-bold"
                                >
                                  <Share2 size={14} className="mr-1" /> Share
                                </button>
                              )}
                              <button onClick={() => navigate(`/admin/edit-quiz/${quiz.id}`)} className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded transition-colors flex items-center text-xs font-bold">
                                <Edit3 size={14} className="mr-1" /> Edit
                              </button>
                            </div>
                          </div>
                        ))}
                        {quizDataState.filter((q) => q.seriesId === series.id).length === 0 && (
                          <p className="text-sm text-gray-400 italic">No quizzes created yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {adminTab === 'requests' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
           <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900">Pending Student Enrollments</h2>
           </div>
           {pendingRequests.length === 0 ? (
             <div className="p-8 text-center text-gray-500">No pending requests.</div>
           ) : (
             <div className="divide-y divide-gray-100">
               {pendingRequests.map((req) => (
                  <div key={req.id} className="p-6 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900">{req.studentName}</h4>
                      <p className="text-sm text-gray-500">Requested access to: <span className="font-bold text-blue-800">{req.seriesName}</span> • {req.date}</p>
                    </div>
                    <div className="flex space-x-2">
                      <button onClick={() => handleReject(req.id)} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50">Reject</button>
                      <button onClick={() => handleApprove(req.id, req.studentName, req.seriesId)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">Approve</button>
                    </div>
                  </div>
               ))}
             </div>
           )}
        </div>
      )}

      {adminTab === 'leaderboard' && (
         <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
           <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-lg font-bold text-gray-900">Series Rankings</h2>
              <select 
                 value={adminLeaderboardSeriesId}
                 onChange={(e) => setAdminLeaderboardSeriesId(e.target.value)}
                 className="border border-gray-300 rounded-lg text-sm p-2 bg-white focus:ring-blue-500 focus:border-blue-500 font-medium text-gray-700">
                {seriesData.map((s) => <option key={s.id} value={s.id.toString()}>{s.title} ({s.group})</option>)}
              </select>
           </div>
           
           {isLeaderboardLoading ? (
             <div className="p-8 text-center text-gray-500">Loading rankings...</div>
           ) : (
             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-4 sm:px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Rank</th>
                     <th className="px-4 sm:px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Student</th>
                     <th className="px-4 sm:px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Score</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-100">
                    {leaderboardData.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 sm:px-6 py-8 text-center text-gray-500">
                          No scores recorded for this series yet.
                        </td>
                      </tr>
                    ) : (
                      leaderboardData.map((entry: any, idx: any) => {
                        const isExpanded = expandedUserId === entry.user_id;
                        return (
                          <Fragment key={idx}>
                            <tr 
                              onClick={() => handleRowClick(entry.user_id)}
                              className={`cursor-pointer transition-all hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/10' : ''}`}
                            >
                              <td className="px-4 sm:px-6 py-4 whitespace-nowrap font-bold text-gray-900">#{entry.rank}</td>
                              <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{entry.name}</td>
                              <td className="px-4 sm:px-6 py-4 whitespace-nowrap font-bold text-blue-700">{entry.score} / {entry.out_of}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50/30">
                                <td colSpan={3} className="px-6 sm:px-12 py-4 border-t border-gray-100 bg-slate-50/50">
                                  <div className="max-w-md space-y-2">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quiz Breakdown</h4>
                                    {isBreakdownLoading ? (
                                      <div className="text-xs text-gray-400 italic">Loading breakdown...</div>
                                    ) : expandedBreakdown.length === 0 ? (
                                      <div className="text-xs text-gray-400 italic">No quizzes found in this series.</div>
                                    ) : (
                                      expandedBreakdown.map((b: any) => (
                                        <div key={b.quiz_id} className="flex justify-between items-center text-sm py-1.5 border-b border-gray-100">
                                          <span className="text-gray-600">{b.quiz_title}</span>
                                          <span className="font-semibold text-gray-800">
                                            {b.score !== null ? `${b.score} / ${b.max_score}` : 'Not attempted'}
                                          </span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                 </tbody>
               </table>
             </div>
           )}
         </div>
      )}
    </div>
  );
};
