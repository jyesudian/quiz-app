import { useState, useEffect, Fragment } from 'react';
import { ChevronRight, Trophy } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';

export const StudentLeaderboard = () => {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [series, setSeries] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedBreakdown, setExpandedBreakdown] = useState<any[]>([]);
  const [isBreakdownLoading, setIsBreakdownLoading] = useState(false);

  const handleRowClick = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }

    setExpandedUserId(userId);
    setIsBreakdownLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_user_series_attempts', {
        series_id_param: parseInt(seriesId || '0'),
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

  useEffect(() => {
    console.log('StudentLeaderboard useEffect triggered, seriesId:', seriesId);
    const fetchLeaderboard = async () => {
      console.log('StudentLeaderboard fetchLeaderboard started for seriesId:', seriesId);
      try {
        console.log('Fetching quiz series metadata...');
        const { data: seriesData, error: seriesError } = await supabase
          .from('quiz_series')
          .select('*')
          .eq('id', seriesId)
          .single();
        
        if (seriesError) {
          console.error('Error fetching quiz series metadata:', seriesError);
          throw seriesError;
        }
        console.log('Successfully fetched quiz series metadata:', seriesData);
        setSeries(seriesData);

        console.log('Fetching leaderboard data...');
        const { data: leaderboardData, error: rpcError } = await supabase.rpc('get_series_leaderboard', { 
          series_id_param: parseInt(seriesId || '0') 
        });

        if (rpcError) {
          console.error('RPC get_series_leaderboard Error:', rpcError);
          setLeaderboard([]);
          toast.error('Leaderboard data not available yet.');
        } else {
          console.log('Successfully fetched leaderboard data:', leaderboardData);
          setLeaderboard(leaderboardData || []);
        }
      } catch (err) {
        console.error('Caught error in fetchLeaderboard:', err);
        toast.error('Failed to load leaderboard');
      } finally {
        console.log('StudentLeaderboard: setting isLoading to false');
        setIsLoading(false);
      }
    };
    
    if (seriesId) {
      fetchLeaderboard();
    } else {
      console.warn('StudentLeaderboard: seriesId is undefined or empty, setting isLoading to false');
      setIsLoading(false);
    }
  }, [seriesId]);

  if (isLoading) return <div className="text-center py-8">Loading leaderboard...</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button onClick={() => navigate('/student')} className="text-blue-600 hover:underline mb-6 flex items-center text-sm font-medium">
        <ChevronRight className="rotate-180 w-4 h-4 mr-1" /> Back to Dashboard
      </button>
      <div className="bg-white rounded-2xl shadow-md border border-blue-100 overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-blue-900 to-blue-800 text-white flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold flex items-center"><Trophy className="mr-3 text-yellow-400" /> Leaderboard</h2>
            <p className="text-blue-200 mt-1">{series?.title} • {series?.group_name}</p>
        </div>
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
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 sm:px-6 py-8 text-center text-gray-500">
                    No scores recorded for this series yet.
                  </td>
                </tr>
              ) : (
                leaderboard.map((entry: any, idx: any) => {
                  const isCurrentUser = user && entry.name === user.name;
                  const isExpanded = expandedUserId === entry.user_id;
                  return (
                    <Fragment key={idx}>
                      <tr 
                        onClick={() => handleRowClick(entry.user_id)} 
                        className={`cursor-pointer transition-all ${isCurrentUser ? 'bg-blue-50/50 border-l-4 border-blue-500' : 'hover:bg-gray-50'} ${isExpanded ? 'bg-blue-50/10' : ''}`}
                      >
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap font-bold text-gray-900">#{entry.rank}</td>
                        <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{entry.name} {isCurrentUser && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">You</span>}</td>
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
      </div>
    </div>
  );
};
