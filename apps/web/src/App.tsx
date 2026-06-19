import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { Login } from './Login';
import Overview from './Overview';
import Accounts from './Accounts';
import Properties from './Properties';
import Property from './Property';
import Groups from './Groups';
import Jobs from './Jobs';
import Doctor from './Doctor';
import Costs from './Costs';
import Quota from './Quota';
import Settings from './Settings';

export default function App() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (state.status !== 'authed') return <Login />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/properties" element={<Properties />} />
        <Route path="/properties/:id" element={<Property />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/health" element={<Doctor />} />
        <Route path="/doctor" element={<Navigate to="/health" replace />} />
        <Route path="/costs" element={<Costs />} />
        <Route path="/quota" element={<Quota />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </AppShell>
  );
}
