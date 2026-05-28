import { useState } from 'react';
import { Mail, Lock, Shield, User } from 'lucide-react';
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';
import { Logo } from '../components/Logo';

export const Login = () => {
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    console.log("handleGoogleSignIn started");
    setIsLoading(true);
    try {
      console.log("Calling supabase.auth.signInWithOAuth");
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      console.log("Response from signInWithOAuth:", { data, error });
      
      if (error) {
        toast.error(error.message);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error("Caught exception in handleGoogleSignIn:", err);
      toast.error(err.message || 'An unexpected error occurred');
      setIsLoading(false);
    }
  };

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    });

    if (error) {
      toast.error(error.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative ambient glowing blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none"></div>
      
      {/* Admin/Student Toggle Button in Top Right */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={() => {
            setIsAdminLogin(!isAdminLogin);
            // Clear any admin form entries when toggling
            setAdminEmail('');
            setAdminPassword('');
          }}
          className="flex items-center space-x-2 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white font-semibold px-4 py-2.5 rounded-xl border border-white/15 transition-all cursor-pointer shadow-lg text-sm backdrop-blur-sm"
          title={isAdminLogin ? "Go to Student Portal" : "Go to Admin Login"}
        >
          {isAdminLogin ? (
            <>
              <User size={16} className="text-blue-300" />
              <span>Student Portal</span>
            </>
          ) : (
            <>
              <Shield size={16} className="text-amber-400" />
              <span>Admin Login</span>
            </>
          )}
        </button>
      </div>
      
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-6">
          <div className="bg-slate-900/40 backdrop-blur-md p-4 rounded-3xl shadow-2xl border border-white/10 flex items-center justify-center">
            <Logo size={80} />
          </div>
        </div>
        <h2 className="mt-2 text-center text-4xl font-extrabold text-white tracking-wider">Daat</h2>
        {isAdminLogin ? (
          <p className="mt-3 text-center text-amber-400 font-semibold text-sm sm:text-base px-4 uppercase tracking-widest">
            Admin & Teacher Portal
          </p>
        ) : (
          <p className="mt-3 text-center text-blue-100/90 font-medium text-sm sm:text-base px-4 leading-relaxed max-w-sm mx-auto">
            Grow in the grace and knowledge of our Lord and Savior Jesus Christ
          </p>
        )}
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-white py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-gray-100">
          <h3 className="text-xl font-bold text-gray-900 mb-6 text-center">
            {isAdminLogin ? 'Admin Sign In' : 'Student Sign In'}
          </h3>

          {!isAdminLogin ? (
            <div className="space-y-6">
              <p className="text-center text-sm text-gray-500 mb-6">Sign in to take your weekly quizzes and view your progress.</p>
              <button
                disabled={isLoading}
                onClick={handleGoogleSignIn}
                className="w-full flex justify-center items-center py-3 px-4 border border-gray-300 rounded-xl shadow-sm bg-white text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="h-5 w-5 mr-3" />
                {isLoading ? 'Signing in...' : 'Sign in with Google'}
              </button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleAdminSignIn}>
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
              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-blue-800 hover:bg-blue-900 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {isLoading ? 'Signing in...' : 'Secure Login'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
