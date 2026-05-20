const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Add : any to components safely without bash interpolation
code = code.replace(/const NavBar = \(\{ (.*?) \}\) => \(/, 'const NavBar = ({ $1 }: any) => (');
code = code.replace(/const AdminDashboard = \(\{ (.*?) \}\) => \{/, 'const AdminDashboard = ({ $1 }: any) => {');
code = code.replace(/const CreateQuiz = \(\{ (.*?) \}\) => \{/, 'const CreateQuiz = ({ $1 }: any) => {');
code = code.replace(/const StudentDashboard = \(\{ (.*?) \}\) => \{/, 'const StudentDashboard = ({ $1 }: any) => {');
code = code.replace(/const TakeQuiz = \(\{ (.*?) \}\) => \{/, 'const TakeQuiz = ({ $1 }: any) => {');
code = code.replace(/const StudentLeaderboard = \(\{ (.*?) \}\) => \{/, 'const StudentLeaderboard = ({ $1 }: any) => {');

// Fix useState types in App
code = code.replace('const [currentUser, setCurrentUser] = useState(null);', 'const [currentUser, setCurrentUser] = useState<any>(null);');
code = code.replace('const [currentView, setCurrentView] = useState(\'dashboard\');', 'const [currentView, setCurrentView] = useState<any>(\'dashboard\');');
code = code.replace('const [selectedSeriesId, setSelectedSeriesId] = useState(null);', 'const [selectedSeriesId, setSelectedSeriesId] = useState<any>(null);');
code = code.replace('const [seriesData, setSeriesData] = useState(INITIAL_MOCK_SERIES);', 'const [seriesData, setSeriesData] = useState<any[]>(INITIAL_MOCK_SERIES);');
code = code.replace('const [quizDataState, setQuizDataState] = useState(MOCK_QUIZZES);', 'const [quizDataState, setQuizDataState] = useState<any[]>(MOCK_QUIZZES);');
code = code.replace('const [editingQuiz, setEditingQuiz] = useState(null);', 'const [editingQuiz, setEditingQuiz] = useState<any>(null);');
code = code.replace('const [pendingRequests, setPendingRequests] = useState([', 'const [pendingRequests, setPendingRequests] = useState<any[]>([');

// Fix inline parameter types
code = code.replace('const toggleFreeze = (id) => {', 'const toggleFreeze = (id: any) => {');
code = code.replace(/setSeriesData\(seriesData.map\(s => s.id === id \?/g, 'setSeriesData(seriesData.map((s: any) => s.id === id ?');
code = code.replace('const handleApprove = (reqId, studentName, seriesId) => {', 'const handleApprove = (reqId: any, studentName: any, seriesId: any) => {');
code = code.replace(/setSeriesData\(seriesData.map\(s => s.id === seriesId \?/g, 'setSeriesData(seriesData.map((s: any) => s.id === seriesId ?');
code = code.replace(/setPendingRequests\(pendingRequests.filter\(r => r.id !== reqId\)\);/g, 'setPendingRequests(pendingRequests.filter((r: any) => r.id !== reqId));');
code = code.replace(/seriesData.map\(\(series\) => \(/g, 'seriesData.map((series: any) => (');
code = code.replace(/quizDataState.filter\(q => q.seriesId === series.id\).map\(quiz => \(/g, 'quizDataState.filter((q: any) => q.seriesId === series.id).map((quiz: any) => (');
code = code.replace(/quizDataState.filter\(q => q.seriesId === series.id\).length === 0/g, 'quizDataState.filter((q: any) => q.seriesId === series.id).length === 0');
code = code.replace(/pendingRequests.map\(req => \(/g, 'pendingRequests.map((req: any) => (');
code = code.replace(/setPendingRequests\(pendingRequests.filter\(r => r.id !== req.id\)\)/g, 'setPendingRequests(pendingRequests.filter((r: any) => r.id !== req.id))');
code = code.replace(/seriesData.map\(s => <option/g, 'seriesData.map((s: any) => <option');

// Fix map/filter in StudentDashboard
code = code.replace(/seriesData.filter\(s => s.enrolled.includes/g, 'seriesData.filter((s: any) => s.enrolled.includes');
code = code.replace(/seriesData.filter\(s => !s.enrolled.includes/g, 'seriesData.filter((s: any) => !s.enrolled.includes');
code = code.replace('const handleJoin = (series) => {', 'const handleJoin = (series: any) => {');
code = code.replace(/seriesData.map\(s => s.id === series.id \?/g, 'seriesData.map((s: any) => s.id === series.id ?');
code = code.replace(/enrolledSeries.map\(\(series\) => \(/g, 'enrolledSeries.map((series: any) => (');
code = code.replace(/availableSeries.map\(series => \(/g, 'availableSeries.map((series: any) => (');

// Fix map/filter in CreateQuiz
code = code.replace('const addOption = (qIndex) => {', 'const addOption = (qIndex: any) => {');
code = code.replace('const handleAutoTranslate = (qIndex) => {', 'const handleAutoTranslate = (qIndex: any) => {');
code = code.replace(/options = newQs\[qIndex\].options.map\(opt => \(\{/g, 'options = newQs[qIndex].options.map((opt: any) => ({');
code = code.replace('const handleSave = (status) => {', 'const handleSave = (status: any) => {');
code = code.replace(/setQuizDataState\(prev => prev.map\(q => q.id === editingQuiz.id \?/g, 'setQuizDataState((prev: any) => prev.map((q: any) => q.id === editingQuiz.id ?');
code = code.replace(/setQuizDataState\(prev => \[\.\.\.prev, \{/g, 'setQuizDataState((prev: any) => [...prev, {');
code = code.replace(/questions.map\(\(q, qIndex\) => \(/g, 'questions.map((q: any, qIndex: any) => (');
code = code.replace(/q.options.map\(\(opt, oIndex\) => \(/g, 'q.options.map((opt: any, oIndex: any) => (');

// Fix map/filter in StudentLeaderboard
code = code.replace(/INITIAL_MOCK_SERIES.find\(s => s.id === selectedSeriesId\)/g, 'INITIAL_MOCK_SERIES.find((s: any) => s.id === selectedSeriesId)');
code = code.replace(/MOCK_LEADERBOARD.filter\(l => l.series === series.title\)/g, 'MOCK_LEADERBOARD.filter((l: any) => l.series === series.title)');

// Fix unused event
code = code.replace(/const \{ data: authListener \} = supabase.auth.onAuthStateChange\(async \(event, session\) => \{/g, 'const { data: authListener } = supabase.auth.onAuthStateChange(async (_event: any, session: any) => {');

// Pass setAuthError
code = code.replace(/const NavBar = \(\{ setCurrentView, currentUser \}: any\) => \(/g, 'const NavBar = ({ setCurrentView, currentUser, setAuthError }: any) => (');
code = code.replace(/<NavBar setCurrentView=\{setCurrentView\} currentUser=\{currentUser\} \/>/g, '<NavBar setCurrentView={setCurrentView} currentUser={currentUser} setAuthError={setAuthError} />');

// Remove React import
code = code.replace(/import React, \{ useState, useEffect \} from 'react';/g, 'import { useState, useEffect } from \'react\';');

fs.writeFileSync('src/App.tsx', code);
