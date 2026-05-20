const fs = require('fs');

const code = fs.readFileSync('src/App.tsx', 'utf8');

// The strategy: extract the components from inside App() and put them outside, then pass props.
// Let's use string manipulation based on known signatures.

let newCode = `import React, { useState, useEffect } from 'react';
import { Book, Play, Users, LogOut, ChevronRight, Plus, Edit3, Shield, User, Mail, Lock, Languages, BrainCircuit, Trophy, List, CheckCircle, XCircle, Snowflake, UserPlus, Trash2 } from 'lucide-react';
import { supabase } from './supabaseClient'; // Import your Supabase client

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
`;

// Extract LoginScreen
const loginScreenMatch = code.match(/const LoginScreen = \(\) => \([\s\S]*?\n  \);/);
newCode += `\nconst LoginScreen = () => {
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [authError, setAuthError] = useState(null);
  return (
${loginScreenMatch[0].replace('const LoginScreen = () => (', '').replace(/;\s*$/, '')}
  );
};\n`;

// Extract NavBar
const navBarMatch = code.match(/const NavBar = \(\) => \([\s\S]*?\n  \);/);
newCode += `\nconst NavBar = ({ setCurrentView, currentUser }) => (\n${navBarMatch[0].replace('const NavBar = () => (', '').replace(/;\s*$/, '')}\n);\n`;

// Extract AdminDashboard
const adminDashboardMatch = code.match(/const AdminDashboard = \(\) => \{[\s\S]*?\n  \};\n\n  const CreateQuiz/);
newCode += `\nconst AdminDashboard = ({ seriesData, setSeriesData, pendingRequests, setPendingRequests, setEditingQuiz, setCurrentView, quizDataState }) => {
  const [adminTab, setAdminTab] = useState('overview'); 
  const [adminLeaderboardSeries, setAdminLeaderboardSeries] = useState(INITIAL_MOCK_SERIES[0].title);
${adminDashboardMatch[0].replace('const AdminDashboard = () => {', '').replace(/\n  };\n\n  const CreateQuiz$/, '\n};')}
\n`;

// Extract CreateQuiz
const createQuizMatch = code.match(/const CreateQuiz = \(\) => \{[\s\S]*?\n  \};\n\n  const StudentDashboard/);
newCode += `\nconst CreateQuiz = ({ editingQuiz, setEditingQuiz, seriesData, setQuizDataState, setCurrentView }) => {\n${createQuizMatch[0].replace('const CreateQuiz = () => {', '').replace(/\n  };\n\n  const StudentDashboard$/, '\n};')}\n`;

// Extract StudentDashboard
const studentDashboardMatch = code.match(/const StudentDashboard = \(\) => \{[\s\S]*?\n  \};\n\n  const TakeQuiz/);
newCode += `\nconst StudentDashboard = ({ seriesData, setSeriesData, currentUser, setSelectedSeriesId, setCurrentView }) => {\n${studentDashboardMatch[0].replace('const StudentDashboard = () => {', '').replace(/\n  };\n\n  const TakeQuiz$/, '\n};')}\n`;

// Extract TakeQuiz
const takeQuizMatch = code.match(/const TakeQuiz = \(\) => \{[\s\S]*?\n  \};\n\n  const StudentLeaderboard/);
newCode += `\nconst TakeQuiz = ({ setCurrentView }) => {\n${takeQuizMatch[0].replace('const TakeQuiz = () => {', '').replace(/\n  };\n\n  const StudentLeaderboard$/, '\n};')}\n`;

// Extract StudentLeaderboard
const studentLeaderboardMatch = code.match(/const StudentLeaderboard = \(\) => \{[\s\S]*?\n  \};\n\n  return \(/);
newCode += `\nconst StudentLeaderboard = ({ selectedSeriesId, setCurrentView, currentUser }) => {\n${studentLeaderboardMatch[0].replace('const StudentLeaderboard = () => {', '').replace(/\n  };\n\n  return \($/, '\n};')}\n`;

// App component
newCode += `\nexport default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);

  const [seriesData, setSeriesData] = useState(INITIAL_MOCK_SERIES);
  const [quizDataState, setQuizDataState] = useState(MOCK_QUIZZES);
  const [editingQuiz, setEditingQuiz] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([
    { id: 101, studentName: 'Sarah John', seriesId: 1, seriesName: 'The Revelation Study', date: 'Just now' }
  ]);

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
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
      } else {
        setCurrentUser(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) supabase.auth.onAuthStateChange(() => {});
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900">
      {!currentUser ? (
        <LoginScreen />
      ) : (
        <>
          <NavBar setCurrentView={setCurrentView} currentUser={currentUser} />
          <main>
            {currentView === 'dashboard' && currentUser.role === 'admin' && <AdminDashboard seriesData={seriesData} setSeriesData={setSeriesData} pendingRequests={pendingRequests} setPendingRequests={setPendingRequests} setEditingQuiz={setEditingQuiz} setCurrentView={setCurrentView} quizDataState={quizDataState} />}
            {currentView === 'dashboard' && currentUser.role === 'student' && <StudentDashboard seriesData={seriesData} setSeriesData={setSeriesData} currentUser={currentUser} setSelectedSeriesId={setSelectedSeriesId} setCurrentView={setCurrentView} />}
            {currentView === 'create-quiz' && currentUser.role === 'admin' && <CreateQuiz editingQuiz={editingQuiz} setEditingQuiz={setEditingQuiz} seriesData={seriesData} setQuizDataState={setQuizDataState} setCurrentView={setCurrentView} />}
            {currentView === 'take-quiz' && currentUser.role === 'student' && <TakeQuiz setCurrentView={setCurrentView} />}
            {currentView === 'student-leaderboard' && currentUser.role === 'student' && <StudentLeaderboard selectedSeriesId={selectedSeriesId} setCurrentView={setCurrentView} currentUser={currentUser} />}
          </main>
        </>
      )}
    </div>
  );
}
`;

fs.writeFileSync('src/App.tsx', newCode);
console.log('Done replacing!');
