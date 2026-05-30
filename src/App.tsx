import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthLayout } from './layouts/AuthLayout';
import { MainLayout } from './layouts/MainLayout';
import { Login } from './pages/Login';
import { UpdatePassword } from './pages/UpdatePassword';
import { AdminDashboard } from './pages/AdminDashboard';
import { CreateQuiz } from './pages/CreateQuiz';
import { StudentDashboard } from './pages/StudentDashboard';
import { TakeQuiz } from './pages/TakeQuiz';
import { StudentLeaderboard } from './pages/StudentLeaderboard';
import { QuizResults } from './pages/QuizResults';
import { useAuth } from './contexts/AuthContext';

const RootRedirect = () => {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xl font-bold text-blue-800">Authenticating...</div>
      </div>
    );
  }
  
  if (user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
  }
  
  return <Navigate to="/login" replace />;
};

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/update-password" element={<UpdatePassword />} />
      </Route>

      <Route element={<MainLayout requiredRole="admin" />}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/create-quiz" element={<CreateQuiz />} />
        <Route path="/admin/edit-quiz/:id" element={<CreateQuiz />} />
      </Route>

      <Route element={<MainLayout requiredRole="student" />}>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/student/quiz/:quizId" element={<TakeQuiz />} />
        <Route path="/student/leaderboard/:seriesId" element={<StudentLeaderboard />} />
      </Route>

      <Route element={<MainLayout />}>
        <Route path="/quiz-results/:quizId/:userId?" element={<QuizResults />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}