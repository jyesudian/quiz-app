import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const AuthLayout = () => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xl font-bold text-blue-800">Loading...</div>
      </div>
    );
  }

  if (user) {
    const from = location.state?.from?.pathname || (user.role === 'admin' ? '/admin' : '/student');
    const search = location.state?.from?.search || '';
    return <Navigate to={from + search} replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900">
      <main>
        <Outlet />
      </main>
    </div>
  );
};
