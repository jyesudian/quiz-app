const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const updatePasswordScreenCode = `
const UpdatePasswordScreen = ({ setCurrentView }: any) => {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleUpdate = async (e: any) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        setCurrentView('dashboard');
      }, 2000);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-8 bg-white rounded-2xl shadow-xl border border-blue-100">
      <div className="flex justify-center mb-6">
        <div className="bg-blue-100 p-3 rounded-full text-blue-800">
          <Lock size={32} />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">Set New Password</h2>
      
      {success ? (
        <div className="text-center">
          <div className="bg-green-100 text-green-800 p-4 rounded-xl mb-4 font-medium">Password updated successfully!</div>
          <p className="text-gray-500">Redirecting to dashboard...</p>
        </div>
      ) : (
        <form onSubmit={handleUpdate} className="space-y-6">
          {error && (
            <div className="bg-red-100 text-red-700 p-3 rounded-lg text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
            <input
              type="password"
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter at least 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-800 text-white font-bold py-3 px-4 rounded-xl hover:bg-blue-900 transition-colors disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      )}
    </div>
  );
};
`;

// Insert the new component before export default function App()
code = code.replace('export default function App() {', updatePasswordScreenCode + '\nexport default function App() {');

// Update onAuthStateChange
code = code.replace(
  'const { data: authListener } = supabase.auth.onAuthStateChange(async (_event: any, session: any) => {',
  `const { data: authListener } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
      if (event === 'PASSWORD_RECOVERY') {
        setCurrentView('update-password');
      }`
);

// Add UpdatePasswordScreen to rendering
// Before {currentView === 'dashboard' && currentUser?.role === 'admin'
code = code.replace(
  "{currentView === 'dashboard' && currentUser?.role === 'admin'",
  "{currentView === 'update-password' && <UpdatePasswordScreen setCurrentView={setCurrentView} />}\n            {currentView === 'dashboard' && currentUser?.role === 'admin'"
);

// We should also ensure that when the user is in update-password view, we don't show the dashboard tabs. 
// The current rendering logic is fine since currentView will be 'update-password' and none of the other conditions will match.

fs.writeFileSync('src/App.tsx', code);
