import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Login } from './Login';
import Accounts from './Accounts';
import Properties from './Properties';
import Property from './Property';
import Groups from './Groups';
import Jobs from './Jobs';
import Doctor from './Doctor';
import Costs from './Costs';
import Settings from './Settings';

const NAV = [
  ['/accounts', 'Accounts'],
  ['/properties', 'Properties'],
  ['/groups', 'Groups'],
  ['/jobs', 'Jobs'],
  ['/doctor', 'Doctor'],
  ['/costs', 'Costs'],
  ['/settings', 'Settings'],
] as const;

export default function App() {
  const { state, signOut } = useAuth();

  if (state.status === 'loading') return <div className="center">Loading…</div>;
  if (state.status !== 'authed') return <Login />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ConsoleVault</span>
        <nav>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <span className="muted">{state.email}</span>
        <button onClick={() => void signOut()}>Sign out</button>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/accounts" replace />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/properties/:id" element={<Property />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/doctor" element={<Doctor />} />
          <Route path="/costs" element={<Costs />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
