import { Book, Shield, User, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const NavBar = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center cursor-pointer" onClick={() => navigate('/')}>
            <Book className="h-8 w-8 text-blue-800" />
            <span className="ml-3 text-xl font-extrabold text-blue-900 tracking-tight">Daat</span>
          </div>
          <div className="flex items-center">
            {user && (
              <>
                <span className="text-sm font-medium text-gray-600 mr-4 hidden sm:block">
                  {user.role === 'admin' ? 'Admin Portal' : `Student: ${user.name}`}
                </span>
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center border border-blue-200">
                  {user.role === 'admin' ? <Shield size={16} className="text-blue-800"/> : <User size={16} className="text-blue-800"/>}
                </div>
                <button
                  onClick={handleLogout}
                  className="ml-4 p-2 text-gray-400 hover:text-red-600 transition-colors" 
                  title="Logout"
                >
                  <LogOut size={20} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
