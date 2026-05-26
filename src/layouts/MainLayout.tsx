import { Outlet, Navigate } from 'react-router-dom';
import { NavBar } from '../components/NavBar';
import { useAuth } from '../contexts/AuthContext';

export const MainLayout = ({ requiredRole }: { requiredRole?: 'student' | 'admin' }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xl font-bold text-blue-800">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    // Redirect to their respective dashboard if they try to access wrong route
    return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900">
      <NavBar />
      <main>
        <Outlet />
      </main>
    </div>
  );
};
