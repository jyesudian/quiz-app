import { useState, useEffect } from 'react';
import { Book, Play, Users, LogOut, ChevronRight, Plus, Edit3, Shield, User, Mail, Lock, Languages, BrainCircuit, Trophy, List, CheckCircle, XCircle, Snowflake, UserPlus, Trash2 } from 'lucide-react';

// @ts-ignore
import { supabase } from './supabaseClient';

const INITIAL_MOCK_SERIES = [
  { id: 1, title: 'The Revelation Study', group: 'Adult Sunday School', totalQuizzes: 3, completed: 42, isBilingual: true, requiresApproval: true, isFrozen: false, enrolled: ['David Raj'] },
  { id: 2, title: 'Genesis Foundations', group: 'Youth Group', totalQuizzes: 4, completed: 15, isBilingual: false, requiresApproval: false, isFrozen: false, enrolled: [] },
  { id: 3, title: 'Lenten Journey', group: 'General Congregation', totalQuizzes: 7, completed: 120, isBilingual: true, requiresApproval: false, isFrozen: true, enrolled: ['David Raj'] },
];

const MOCK_QUIZZES = [
  { id: 101, seriesId: 1, title: 'Revelation Chapter 1', status: 'published', questionsList: [
    { id: 1, type: 'single', textEn: 'Who wrote the book of Revelation?', textTa: 'வெளிப்படுத்தின விசேஷத்தை எழுதியவர் யார்?', options: [{en: 'Apostle Paul', ta: 'அப்போஸ்தலனாகிய பவுல்'}, {en: 'Apostle John', ta: 'அப்போஸ்தலனாகிய யோவான்'}], answerIndex: 0, aiRubric: '' },
    { id: 2, type: 'text', textEn: 'Describe what John saw in his first vision.', textTa: 'யோவான் தனது முதல் தரிசனத்தில் பார்த்ததை விவரி.', options: [], answerIndex: 0, aiRubric: 'Student should mention Jesus, lampstands, and stars.' }
  ]},
  { id: 102, seriesId: 1, title: 'The Seven Churches', status: 'draft', questionsList: [] },
  { id: 201, seriesId: 2, title: 'Creation Days 1-3', status: 'published', questionsList: [] },
];

const MOCK_LEADERBOARD = [
  { rank: 1, name: 'David Raj', score: 285, outOf: 300, series: 'The Revelation Study', group: 'Adult Sunday School' },
  { rank: 2, name: 'Michael Thomas', score: 270, outOf: 300, series: 'The Revelation Study', group: 'Adult Sunday School' },
  { rank: 3, name: 'Priya Sam', score: 255, outOf: 300, series: 'The Revelation Study', group: 'Adult Sunday School' },
];

const LoginScreen = ({ setIsAdminLogin, isAdminLogin, setAuthError, authError, adminEmail, setAdminEmail, adminPassword, setAdminPassword }: any) => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-96 bg-blue-900 rounded-b-[40%] shadow-2xl opacity-90 transform -translate-y-20"></div>
      
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-6">
          <div className="bg-white p-4 rounded-full shadow-lg border-4 border-blue-100">
            <Book size={48} className="text-blue-800" />
          </div>
        </div>
        <h2 className="mt-2 text-center text-4xl font-extrabold text-white tracking-tight">Grace Quiz Portal</h2>
        <p className="mt-2 text-center text-blue-100 font-medium">Grow in faith, word by word.</p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-white py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-gray-100">
          <div className="flex justify-center space-x-4 mb-8">
            <button onClick={() => setIsAdminLogin(false)} className={`pb-2 px-4 text-sm font-bold transition-all ${!isAdminLogin ? 'border-b-4 border-blue-600 text-blue-900' : 'text-gray-400 hover:text-gray-600'}`}>
              Student Portal
            </button>
            <button onClick={() => setIsAdminLogin(true)} className={`pb-2 px-4 text-sm font-bold transition-all ${isAdminLogin ? 'border-b-4 border-blue-600 text-blue-900' : 'text-gray-400 hover:text-gray-600'}`}>
              Admin/Teacher
            </button>
          </div>

          {authError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
              <strong className="font-bold">Error:</strong>
              <span className="block sm:inline"> {authError}</span>
            </div>
          )}

          {!isAdminLogin ? (
            <div className="space-y-6">
              <p className="text-center text-sm text-gray-500 mb-6">Sign in to take your weekly quizzes and view your progress.</p>
              <button
                onClick={async () => {
                  setAuthError(null);
                  const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                      redirectTo: window.location.origin,
                    },
                  });
                  if (error) {
                    console.error('Google Sign-In Error:', error.message);
                    setAuthError(error.message);
                  }
                }}
                className="w-full flex justify-center items-center py-3 px-4 border border-gray-300 rounded-xl shadow-sm bg-white text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="h-5 w-5 mr-3" />
                Sign in with Google
              </button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={async (e) => {
              e.preventDefault();
              setAuthError(null);
              const { data, error } = await supabase.auth.signInWithPassword({
                email: adminEmail,
                password: adminPassword,
              });

              if (error) {
                console.error('Admin Sign-In Error:', error.message);
                setAuthError(error.message);
              } else if (data.user && data.session) {
                setAdminEmail('');
                setAdminPassword('');
              }
            }}>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email address</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Mail className="h-5 w-5 text-gray-400" /></div>
                  <input
                    type="email"
                    required
                    className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-xl py-3 border"
                    placeholder="admin@church.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Lock className="h-5 w-5 text-gray-400" /></div>
                  <input
                    type="password"
                    required
                    className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-xl py-3 border"
                    placeholder="••••••••"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-blue-800 hover:bg-blue-900 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                Secure Login
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

const NavBar = ({ setCurrentView, currentUser, setAuthError }: any) => (
  <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between h-16">
        <div className="flex items-center cursor-pointer" onClick={() => setCurrentView('dashboard')}>
          <Book className="h-8 w-8 text-blue-800" />
          <span className="ml-3 text-xl font-extrabold text-blue-900 tracking-tight">Grace Quiz</span>
        </div>
        <div className="flex items-center">
          <span className="text-sm font-medium text-gray-600 mr-4 hidden sm:block">
            {currentUser?.role === 'admin' ? 'Admin Portal' : `Student: ${currentUser?.name}`}
          </span>
          <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center border border-blue-200">
            {currentUser?.role === 'admin' ? <Shield size={16} className="text-blue-800"/> : <User size={16} className="text-blue-800"/>}
          </div>
          <button
            onClick={async () => {
              setAuthError(null);
              await supabase.auth.signOut();
            }}
            className="ml-4 p-2 text-gray-400 hover:text-red-600 transition-colors" title="Logout">
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </div>
  </nav>
);

const AdminDashboard = ({ seriesData, setSeriesData, pendingRequests, setPendingRequests, setEditingQuiz, setCurrentView, quizDataState }: any) => {
  const [adminTab, setAdminTab] = useState('overview'); 
  const [adminLeaderboardSeries, setAdminLeaderboardSeries] = useState(INITIAL_MOCK_SERIES[0].title);

  const toggleFreeze = (id: any) => {
    setSeriesData(seriesData.map((s: any) => s.id === id ? { ...s, isFrozen: !s.isFrozen } : s));
  };

  const handleApprove = (reqId: any, studentName: any, seriesId: any) => {
    setSeriesData(seriesData.map((s: any) => s.id === seriesId ? { ...s, enrolled: [...s.enrolled, studentName] } : s));
    setPendingRequests(pendingRequests.filter((r: any) => r.id !== reqId));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">Manage quiz series, evaluate AI scoring, and view leaderboards.</p>
        </div>
        <button onClick={() => { setEditingQuiz(null); setCurrentView('create-quiz'); }} className="bg-blue-800 hover:bg-blue-900 text-white px-6 py-2.5 rounded-xl font-bold shadow-sm transition-all flex items-center">
          <Plus size={18} className="mr-2" /> Create New Quiz
        </button>
      </div>

      <div className="flex space-x-1 border-b border-gray-200 mb-8 overflow-x-auto">
        <button onClick={() => setAdminTab('overview')} className={`py-3 px-6 text-sm font-bold border-b-2 whitespace-nowrap flex items-center ${adminTab === 'overview' ? 'border-blue-800 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><List size={16} className="mr-2"/> Series Overview</button>
        <button onClick={() => setAdminTab('leaderboard')} className={`py-3 px-6 text-sm font-bold border-b-2 whitespace-nowrap flex items-center ${adminTab === 'leaderboard' ? 'border-blue-800 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Trophy size={16} className="mr-2"/> Leaderboards</button>
        <button onClick={() => setAdminTab('ai-review')} className={`py-3 px-6 text-sm font-bold border-b-2 whitespace-nowrap flex items-center ${adminTab === 'ai-review' ? 'border-blue-800 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><BrainCircuit size={16} className="mr-2"/> AI Review <span className="ml-2 bg-red-100 text-red-800 py-0.5 px-2 rounded-full text-xs">2</span></button>
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
                {seriesData.map((series: any) => (
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
                      <button onClick={() => toggleFreeze(series.id)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${series.isFrozen ? 'border-blue-300 text-blue-700 hover:bg-blue-50' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}>
                        {series.isFrozen ? 'Unfreeze Series' : 'Freeze / Conclude Series'}
                      </button>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Quizzes in Series</h4>
                      <div className="space-y-2">
                        {quizDataState.filter((q: any) => q.seriesId === series.id).map((quiz: any) => (
                          <div key={quiz.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:border-blue-300 transition-colors">
                            <div>
                              <span className="text-sm font-bold text-gray-800">{quiz.title}</span>
                              <span className={`ml-3 text-xs px-2 py-0.5 rounded-full font-bold ${quiz.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{quiz.status === 'published' ? 'Published' : 'Draft'}</span>
                            </div>
                            <button onClick={() => { setEditingQuiz(quiz); setCurrentView('create-quiz'); }} className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded transition-colors flex items-center text-xs font-bold">
                              <Edit3 size={14} className="mr-1" /> Edit
                            </button>
                          </div>
                        ))}
                        {quizDataState.filter((q: any) => q.seriesId === series.id).length === 0 && (
                          <p className="text-sm text-gray-400 italic">No quizzes created yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div>
            <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-2xl shadow-sm p-6 text-white mb-6">
              <h2 className="text-lg font-bold mb-4">Quick Stats</h2>
              <div className="space-y-4">
                <div className="bg-blue-800/50 p-4 rounded-xl backdrop-blur-sm border border-blue-700">
                  <div className="text-blue-200 text-sm font-medium">Total Students</div>
                  <div className="text-3xl font-extrabold mt-1">128</div>
                </div>
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
               {pendingRequests.map((req: any) => (
                  <div key={req.id} className="p-6 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900">{req.studentName}</h4>
                      <p className="text-sm text-gray-500">Requested access to: <span className="font-bold text-blue-800">{req.seriesName}</span> • {req.date}</p>
                    </div>
                    <div className="flex space-x-2">
                      <button onClick={() => setPendingRequests(pendingRequests.filter((r: any) => r.id !== req.id))} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50">Reject</button>
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
                 value={adminLeaderboardSeries}
                 onChange={(e) => setAdminLeaderboardSeries(e.target.value)}
                 className="border border-gray-300 rounded-lg text-sm p-2 bg-white focus:ring-blue-500 focus:border-blue-500 font-medium text-gray-700">
                {seriesData.map((s: any) => <option key={s.id} value={s.title}>{s.title} ({s.group})</option>)}
              </select>
           </div>
           {MOCK_LEADERBOARD.filter((l: any) => l.series === adminLeaderboardSeries).length > 0 ? (
             <table className="min-w-full divide-y divide-gray-200">
               <thead className="bg-gray-50">
                 <tr>
                   <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Rank</th>
                   <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Student Name</th>
                   <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Total Score</th>
                 </tr>
               </thead>
               <tbody className="bg-white divide-y divide-gray-100">
                 {MOCK_LEADERBOARD.filter((l: any) => l.series === adminLeaderboardSeries).map((entry: any, idx: any) => (
                   <tr key={idx} className="hover:bg-gray-50 transition-colors">
                     <td className="px-6 py-4 whitespace-nowrap">
                       <div className="flex items-center">
                         {entry.rank === 1 && <Trophy className="text-yellow-500 mr-2 w-5 h-5" />}
                         {entry.rank === 2 && <Trophy className="text-gray-400 mr-2 w-5 h-5" />}
                         {entry.rank === 3 && <Trophy className="text-amber-600 mr-2 w-5 h-5" />}
                         <span className={`font-bold ${entry.rank <= 3 ? 'text-gray-900' : 'text-gray-500 ml-7'}`}>#{entry.rank}</span>
                       </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">{entry.name}</td>
                     <td className="px-6 py-4 whitespace-nowrap">
                       <span className="font-bold text-blue-700">{entry.score}</span>
                       <span className="text-xs text-gray-500 ml-1">/ {entry.outOf}</span>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           ) : (
             <div className="p-8 text-center text-gray-500">No leaderboard data available for this series.</div>
           )}
         </div>
      )}
      {adminTab === 'ai-review' && (
         <div className="p-8 text-center bg-white rounded-xl border border-gray-100"><h3 className="text-xl font-bold text-gray-400">AI Review Dashboard active</h3></div>
      )}
    </div>
  );
};

const CreateQuiz = ({ editingQuiz, setEditingQuiz, seriesData, setQuizDataState, setCurrentView }: any) => {
  const [isBilingual, setIsBilingual] = useState(true);
  const [seriesSelection, setSeriesSelection] = useState<string>(editingQuiz ? editingQuiz.seriesId.toString() : 'new');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [quizTitle, setQuizTitle] = useState(editingQuiz ? editingQuiz.title : '');

  const [questions, setQuestions] = useState<any[]>(editingQuiz && editingQuiz.questionsList && editingQuiz.questionsList.length > 0 ? editingQuiz.questionsList : [
    { id: 1, type: 'single', textEn: '', textTa: '', options: [{ en: '', ta: '' }], answerIndex: 0, aiRubric: '' }
  ]);

  const addQuestion = () => setQuestions([...questions, { id: Date.now(), type: 'single', textEn: '', textTa: '', options: [{ en: '', ta: '' }], answerIndex: 0, aiRubric: '' }]);
  const addOption = (qIndex: any) => { const newQs = [...questions]; newQs[qIndex].options.push({ en: '', ta: '' }); setQuestions(newQs); };

  const handleAutoTranslate = (qIndex: any) => {
    const newQs = [...questions];
    if(newQs[qIndex].textEn) newQs[qIndex].textTa = "(Translated) " + newQs[qIndex].textEn; 
    if (newQs[qIndex].type === 'single' || newQs[qIndex].type === 'multiple') {
      newQs[qIndex].options = newQs[qIndex].options.map((opt: any) => ({ ...opt, ta: opt.en ? "(Translated) " + opt.en : '' }));
    }
    setQuestions(newQs);
  };

  const handleSave = (status: any) => {
    if (editingQuiz) {
      setQuizDataState((prev: any) => prev.map((q: any) => q.id === editingQuiz.id ? { ...q, title: quizTitle, status, seriesId: parseInt(seriesSelection), questionsList: questions } : q));
    } else {
      setQuizDataState((prev: any) => [...prev, { id: Date.now(), seriesId: seriesSelection === 'new' ? Date.now() : parseInt(seriesSelection), title: quizTitle, status, questionsList: questions }]);
    }
    setCurrentView('dashboard');
    setEditingQuiz(null);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => { setCurrentView('dashboard'); setEditingQuiz(null); }} className="text-blue-600 hover:underline flex items-center text-sm font-medium">
          <ChevronRight className="rotate-180 w-4 h-4 mr-1" /> Back to Dashboard
        </button>
        <div className="space-x-3">
          <button onClick={() => handleSave('draft')} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">Save as Draft</button>
          <button onClick={() => handleSave('published')} className="px-4 py-2 bg-blue-800 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-900">{editingQuiz ? 'Update Quiz' : 'Update Quiz'}</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-blue-50 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Quiz Title (English)</label>
            <input type="text" value={quizTitle} onChange={(e) => setQuizTitle(e.target.value)} className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2" placeholder="e.g. Revelation Chapter 1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Add to Series</label>
            <select 
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 border p-2 mb-3"
              value={seriesSelection}
              onChange={(e) => setSeriesSelection(e.target.value)}
            >
              <option value="new">Create New Series...</option>
              {seriesData.map((s: any) => <option key={s.id} value={s.id.toString()}>{s.title}</option>)}
            </select>
          </div>
        </div>

        {seriesSelection === 'new' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-bold text-gray-900 mb-3">New Series Settings</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Series Name</label>
                <input type="text" className="w-full border-gray-300 rounded text-sm border p-2 focus:ring-blue-500" placeholder="e.g. Lenten Journey" value={newSeriesName} onChange={(e) => setNewSeriesName(e.target.value)} />
              </div>
              <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Access Control</label>
                 <label className="flex items-center space-x-2 mt-2">
                   <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4" />
                   <span className="text-sm font-medium text-gray-700">Require Approval to Join</span>
                 </label>
              </div>
            </div>
          </div>
        )}
        
        <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-100">
          <div>
            <h4 className="text-sm font-bold text-blue-900 flex items-center"><Languages size={16} className="mr-2"/> Bilingual Mode</h4>
            <p className="text-xs text-blue-700 mt-1">Enable to provide questions and answers in both English and Tamil.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={isBilingual} onChange={(e) => setIsBilingual(e.target.checked)} />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      <div className="space-y-6">
        {questions.map((q: any, qIndex: any) => (
          <div key={q.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex justify-between items-center">
              <span className="font-bold text-gray-700">Question {qIndex + 1}</span>
              <div className="flex space-x-4 items-center">
                <select 
                  className="text-sm border-gray-300 rounded border p-1 focus:ring-blue-500 bg-white"
                  value={q.type}
                  onChange={(e) => {
                    const newQs = [...questions];
                    newQs[qIndex].type = e.target.value;
                    setQuestions(newQs);
                  }}
                >
                  <option value="single">Single Choice</option>
                  <option value="multiple">Multiple Choice</option>
                  <option value="text">Text Entry (AI Graded)</option>
                </select>
                <button className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
              </div>
            </div>
            
            <div className="p-6">
              <div className={`grid grid-cols-1 ${isBilingual ? 'lg:grid-cols-2' : ''} gap-6 mb-6`}>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">English Text</label>
                  <textarea className="w-full border-gray-300 rounded-md border p-3" rows={2} placeholder="Enter question..." value={q.textEn} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].textEn = e.target.value; setQuestions(newQs); }}></textarea>
                </div>
                {isBilingual && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex justify-between items-center">
                      <span>Tamil Text (தமிழ்)</span>
                      <button onClick={() => handleAutoTranslate(qIndex)} className="text-blue-600 flex items-center hover:underline bg-blue-50 px-2 py-0.5 rounded transition-colors">
                        <Languages size={14} className="mr-1"/> Auto-Translate
                      </button>
                    </label>
                    <textarea className="w-full border-gray-300 rounded-md border p-3 bg-slate-50" rows={2} placeholder="தமிழில்..." value={q.textTa} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].textTa = e.target.value; setQuestions(newQs); }}></textarea>
                  </div>
                )}
              </div>

              {q.type === 'text' && (
                <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <label className="block text-sm font-bold text-amber-900 mb-2 flex items-center">
                    <BrainCircuit size={16} className="mr-2"/> AI Grading Rubric / Golden Answer
                  </label>
                  <p className="text-xs text-amber-700 mb-3">Provide the correct answer or key points. The AI grades based on semantic similarity to this text.</p>
                  <textarea 
                    className="w-full border-amber-300 rounded-md shadow-sm border p-3 focus:ring-amber-500 focus:border-amber-500 bg-white" 
                    rows={2} 
                    placeholder="e.g., The student must mention John was on Patmos..."
                    value={q.aiRubric}
                    onChange={(e) => { const newQs = [...questions]; newQs[qIndex].aiRubric = e.target.value; setQuestions(newQs); }}
                  ></textarea>
                </div>
              )}

              {(q.type === 'single' || q.type === 'multiple') && (
                <div className="space-y-4 pl-4 border-l-2 border-gray-100">
                  {q.options.map((opt: any, oIndex: any) => (
                    <div key={oIndex} className={`grid grid-cols-1 ${isBilingual ? 'lg:grid-cols-12' : 'lg:grid-cols-12'} gap-4 items-center`}>
                        <div className="lg:col-span-1 text-center">
                          <input type={q.type === 'single' ? 'radio' : 'checkbox'} name={`q-${q.id}`} className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className={isBilingual ? 'lg:col-span-5' : 'lg:col-span-11'}>
                          <input type="text" className="w-full border-gray-300 rounded text-sm border p-2 focus:ring-blue-500" placeholder={`Option ${oIndex + 1} (English)`} value={opt.en} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].options[oIndex].en = e.target.value; setQuestions(newQs); }} />
                        </div>
                        {isBilingual && (
                          <div className="lg:col-span-6">
                            <input type="text" className="w-full border-gray-300 rounded text-sm border p-2 focus:ring-blue-500 bg-slate-50" placeholder={`விருப்பம் ${oIndex + 1} (Tamil)`} value={opt.ta} onChange={(e) => { const newQs = [...questions]; newQs[qIndex].options[oIndex].ta = e.target.value; setQuestions(newQs); }} />
                          </div>
                        )}
                    </div>
                  ))}
                  <button onClick={() => addOption(qIndex)} className="text-xs text-blue-600 font-bold flex items-center mt-2 hover:bg-blue-50 px-2 py-1 rounded transition-colors">
                    <Plus size={14} className="mr-1" /> Add Option
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <button onClick={addQuestion} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-bold hover:bg-gray-50 hover:text-blue-600 transition-all flex items-center justify-center">
          <Plus size={20} className="mr-2" /> Add Another Question
        </button>
      </div>
    </div>
  );
};

const StudentDashboard = ({ seriesData, setSeriesData, currentUser, setSelectedSeriesId, setCurrentView }: any) => {
  const enrolledSeries = seriesData.filter((s: any) => s.enrolled.includes(currentUser.name));
  const availableSeries = seriesData.filter((s: any) => !s.enrolled.includes(currentUser.name) && !s.isFrozen);

  const handleJoin = (series: any) => {
    if (series.requiresApproval) {
      alert(`Request sent to admin to join "${series.title}".`);
    } else {
      setSeriesData(seriesData.map((s: any) => s.id === series.id ? { ...s, enrolled: [...s.enrolled, currentUser.name] } : s));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-10 bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
        <div className="mb-4 sm:mb-0">
          <h1 className="text-3xl font-extrabold text-blue-900">Welcome, {currentUser.name}</h1>
          <p className="text-gray-600 mt-2">Your faithful study journey continues.</p>
        </div>
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center"><Book className="mr-2 text-blue-600" /> My Active Studies</h2>
      
      {enrolledSeries.length === 0 ? (
         <div className="p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-center text-gray-500 mb-10">You are not enrolled in any active series yet. Browse available series below.</div>
      ) : (
        enrolledSeries.map((series: any) => (
          <div key={series.id} className={`bg-white rounded-2xl shadow-md border overflow-hidden mb-8 ${series.isFrozen ? 'border-gray-200 opacity-90' : 'border-blue-200'}`}>
            <div className={`p-6 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${series.isFrozen ? 'bg-gradient-to-r from-gray-700 to-gray-600' : 'bg-gradient-to-r from-blue-900 to-blue-800'}`}>
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-2xl font-bold">{series.title}</h3>
                  {series.isFrozen && <span className="bg-white/20 text-white text-xs px-2 py-1 rounded font-bold flex items-center"><Snowflake size={12} className="mr-1"/> Concluded</span>}
                </div>
                <p className="text-white/80 text-sm mt-1 mb-3">{series.group} • {series.totalQuizzes} Quizzes Total</p>
                <button onClick={() => { setSelectedSeriesId(series.id); setCurrentView('student-leaderboard'); }} className="text-sm bg-white/10 hover:bg-white/20 text-white py-1.5 px-3 rounded inline-flex items-center transition-colors border border-white/20">
                  <Trophy size={14} className="mr-2 text-yellow-400" /> View {series.isFrozen ? 'Final' : 'Series'} Leaderboard
                </button>
              </div>
            </div>
            
            {!series.isFrozen && (
              <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white hover:bg-blue-50/30 transition-colors">
                <div className="flex items-center mb-4 sm:mb-0">
                  <div className="h-6 w-6 rounded-full border-2 border-blue-500 mr-4 flex items-center justify-center"><div className="h-2 w-2 bg-blue-500 rounded-full"></div></div>
                  <div>
                    <h4 className="font-bold text-blue-900 text-lg">Next Up: Quiz 2</h4>
                    <p className="text-sm text-gray-500 mt-1">15 Questions • Est. 10 mins {series.isBilingual && "• EN/TA"}</p>
                  </div>
                </div>
                <button onClick={() => setCurrentView('take-quiz')} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-sm transition-all flex items-center justify-center">
                  <Play size={16} className="mr-2 fill-current" /> Start Quiz
                </button>
              </div>
            )}
          </div>
        ))
      )}

      <h2 className="text-xl font-bold text-gray-900 mb-6 mt-12 flex items-center border-t pt-8"><UserPlus className="mr-2 text-blue-600" /> Explore & Join Series</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         {availableSeries.map((series: any) => (
            <div key={series.id} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
               <h3 className="text-lg font-bold text-blue-900">{series.title}</h3>
               <p className="text-sm text-gray-500 mt-1">{series.group}</p>
               <div className="mt-4 flex items-center gap-2 mb-6">
                  {series.requiresApproval ? <span className="bg-amber-50 text-amber-700 text-xs px-2 py-1 rounded font-bold border border-amber-200 flex items-center"><Lock size={12} className="mr-1"/> Request Required</span> : <span className="bg-green-50 text-green-700 text-xs px-2 py-1 rounded font-bold border border-green-200">Open Access</span>}
               </div>
               <button onClick={() => handleJoin(series)} className={`w-full py-2 rounded-lg font-bold text-sm transition-colors ${series.requiresApproval ? 'bg-white border border-blue-600 text-blue-700 hover:bg-blue-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                  {series.requiresApproval ? 'Request Access' : 'Unlock / Join Instantly'}
               </button>
            </div>
         ))}
      </div>
    </div>
  );
};

const TakeQuiz = ({ setCurrentView }: any) => {
  const [currentQuestion, setCurrentQuestion] = useState<number>(0);
  const [answers, setAnswers] = useState<any>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  
  const isBilingual = true; 
  const quizData = [
    { id: 1, type: 'single', qEn: 'Who wrote the book of Revelation?', qTa: 'வெளிப்படுத்தின விசேஷத்தை எழுதியவர் யார்?', options: [ { id: 'a', en: 'Apostle Paul', ta: 'அப்போஸ்தலனாகிய பவுல்' }, { id: 'b', en: 'Apostle John', ta: 'அப்போஸ்தலனாகிய யோவான்' } ] },
    { id: 2, type: 'text', qEn: 'Describe what John saw in his first vision.', qTa: 'யோவான் தனது முதல் தரிசனத்தில் பார்த்ததை விவரி.', options: [] }
  ];

  const q = quizData[currentQuestion];

  if (isSubmitted) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-3xl shadow-lg p-10 border border-blue-100">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle className="w-10 h-10 text-green-600" /></div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Quiz Completed!</h2>
          <button onClick={() => setCurrentView('dashboard')} className="mt-8 bg-blue-800 hover:bg-blue-900 text-white px-8 py-3 rounded-xl font-bold shadow-sm transition-all">Return to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => setCurrentView('dashboard')} className="text-gray-500 hover:text-gray-800 flex items-center text-sm font-medium"><XCircle className="w-5 h-5 mr-1" /> Exit Quiz</button>
        <div className="text-sm font-bold text-blue-800 bg-blue-100 px-3 py-1 rounded-full">Question {currentQuestion + 1} of {quizData.length}</div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-blue-100 p-8 sm:p-10 mb-8">
        <div className="mb-8 border-b border-gray-100 pb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">{q.qEn}</h2>
          {isBilingual && <h3 className="text-xl font-medium text-gray-500 font-serif">{q.qTa}</h3>}
        </div>
        
        <div className="space-y-4">
          {(q.type === 'single' || q.type === 'multiple') && q.options.map((opt: any, idx: any) => {
            const isSelected = answers[currentQuestion] === opt.id;
            return (
              <label key={idx} className={`flex items-start p-5 rounded-2xl border-2 cursor-pointer transition-all ${isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}>
                <div className="flex items-center h-6 mr-4"><input type="radio" checked={isSelected} onChange={() => setAnswers({...answers, [currentQuestion]: opt.id})} className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-300" /></div>
                <div className="flex-1">
                  <p className={`text-lg font-bold ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>{opt.en}</p>
                  {isBilingual && <p className={`text-md mt-1 font-serif ${isSelected ? 'text-blue-700' : 'text-gray-500'}`}>{opt.ta}</p>}
                </div>
              </label>
            );
          })}
          {q.type === 'text' && (
            <textarea className="w-full border-gray-300 border-2 rounded-2xl p-5 text-lg focus:ring-4 focus:border-blue-500" rows={5} placeholder="Type your answer here..." value={answers[currentQuestion] || ''} onChange={(e) => setAnswers({...answers, [currentQuestion]: e.target.value})}></textarea>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((prev: number) => prev - 1)} className="px-6 py-3 rounded-xl font-bold text-sm bg-white border border-gray-300 text-gray-700 disabled:opacity-50">Previous</button>
        {currentQuestion === quizData.length - 1 ? (
          <button onClick={() => setIsSubmitted(true)} className="bg-green-600 text-white px-8 py-3 rounded-xl font-bold shadow-md">Submit Quiz</button>
        ) : (
          <button onClick={() => setCurrentQuestion((prev: number) => prev + 1)} className="bg-blue-800 text-white px-8 py-3 rounded-xl font-bold shadow-sm">Next</button>
        )}
      </div>
    </div>
  );
};

const StudentLeaderboard = ({ selectedSeriesId, setCurrentView, currentUser }: any) => {
  const series = INITIAL_MOCK_SERIES.find((s: any) => s.id === selectedSeriesId) || INITIAL_MOCK_SERIES[0];
  const seriesLeaderboard = MOCK_LEADERBOARD.filter((l: any) => l.series === series.title);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button onClick={() => setCurrentView('dashboard')} className="text-blue-600 hover:underline mb-6 flex items-center text-sm font-medium">
        <ChevronRight className="rotate-180 w-4 h-4 mr-1" /> Back to Dashboard
      </button>
      <div className="bg-white rounded-2xl shadow-md border border-blue-100 overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-blue-900 to-blue-800 text-white flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold flex items-center"><Trophy className="mr-3 text-yellow-400" /> Leaderboard</h2>
            <p className="text-blue-200 mt-1">{series.title} • {series.group}</p>
          </div>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Rank</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Student</th>
              <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase">Score</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {seriesLeaderboard.map((entry: any, idx: any) => {
              const isCurrentUser = currentUser && entry.name === currentUser.name;
              return (
                <tr key={idx} className={`${isCurrentUser ? 'bg-blue-50/50 border-l-4 border-blue-500' : 'hover:bg-gray-50'}`}>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">#{entry.rank}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{entry.name} {isCurrentUser && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">You</span>}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-700">{entry.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [selectedSeriesId, setSelectedSeriesId] = useState<any>(null);

  const [seriesData, setSeriesData] = useState<any[]>(INITIAL_MOCK_SERIES);
  const [quizDataState, setQuizDataState] = useState<any[]>(MOCK_QUIZZES);
  const [editingQuiz, setEditingQuiz] = useState<any>(null);
  const [pendingRequests, setPendingRequests] = useState<any[]>([
    { id: 101, studentName: 'Sarah John', seriesId: 1, seriesName: 'The Revelation Study', date: 'Just now' }
  ]);

  const [isAdminLogin, setIsAdminLogin] = useState<boolean>(false);
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [authError, setAuthError] = useState<any>(null);

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event: any, session: any) => {
      if (session) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', session.user.id)
          .single();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
          setCurrentUser({
            id: session.user.id,
            name: session.user.email || 'New User',
            role: 'student',
          });
        } else {
          setCurrentUser({
            id: session.user.id,
            name: profile.full_name || session.user.email,
            role: profile.role,
          });
        }
        setAuthError(null);
      } else {
        setCurrentUser(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session) supabase.auth.onAuthStateChange((_e: any, _s: any) => {});
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900">
      {!currentUser ? (
        <LoginScreen 
          setIsAdminLogin={setIsAdminLogin} 
          isAdminLogin={isAdminLogin} 
          setAuthError={setAuthError} 
          authError={authError} 
          adminEmail={adminEmail} 
          setAdminEmail={setAdminEmail} 
          adminPassword={adminPassword} 
          setAdminPassword={setAdminPassword} 
        />
      ) : (
        <>
          <NavBar setCurrentView={setCurrentView} currentUser={currentUser} setAuthError={setAuthError} />
          <main>
            {currentView === 'dashboard' && currentUser?.role === 'admin' && <AdminDashboard seriesData={seriesData} setSeriesData={setSeriesData} pendingRequests={pendingRequests} setPendingRequests={setPendingRequests} setEditingQuiz={setEditingQuiz} setCurrentView={setCurrentView} quizDataState={quizDataState} />}
            {currentView === 'dashboard' && currentUser?.role === 'student' && <StudentDashboard seriesData={seriesData} setSeriesData={setSeriesData} currentUser={currentUser} setSelectedSeriesId={setSelectedSeriesId} setCurrentView={setCurrentView} />}
            {currentView === 'create-quiz' && currentUser?.role === 'admin' && <CreateQuiz editingQuiz={editingQuiz} setEditingQuiz={setEditingQuiz} seriesData={seriesData} setQuizDataState={setQuizDataState} setCurrentView={setCurrentView} />}
            {currentView === 'take-quiz' && currentUser?.role === 'student' && <TakeQuiz setCurrentView={setCurrentView} />}
            {currentView === 'student-leaderboard' && currentUser?.role === 'student' && <StudentLeaderboard selectedSeriesId={selectedSeriesId} setCurrentView={setCurrentView} currentUser={currentUser} />}
          </main>
        </>
      )}
    </div>
  );
}