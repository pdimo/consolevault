import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { Login } from './Login';
import Overview from './Overview';
import Clients from './Clients';
import ClientWorkspace from './ClientWorkspace';
import ClientContent from './ClientContent';
import ClientCoverage from './ClientCoverage';
import ClientConfigure from './ClientConfigure';
import Dashboard from './Dashboard';
import Opportunities from './Opportunities';
import Accounts from './Accounts';
import Properties from './Properties';
import Groups from './Groups';
import Jobs from './Jobs';
import Doctor from './Doctor';
import Costs from './Costs';
import Quota from './Quota';
import Settings from './Settings';

/** Param-preserving redirects from the old routes into the client workspace. */
function DashboardRedirect() {
  const { type = '', id = '' } = useParams();
  return <Navigate to={`/clients/${type}/${id}/report`} replace />;
}
function PropertyConfigRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/clients/property/${id}/configure`} replace />;
}

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
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Overview />} />

        {/* Clients — the client-first workspace */}
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:type/:id" element={<ClientWorkspace />}>
          <Route index element={<Navigate to="report" replace />} />
          <Route path="report" element={<Dashboard embedded />} />
          <Route path="opportunities" element={<Opportunities />} />
          <Route path="content" element={<ClientContent />} />
          <Route path="coverage" element={<ClientCoverage />} />
          <Route path="configure" element={<ClientConfigure />} />
        </Route>

        {/* Data / admin */}
        <Route path="/properties" element={<Properties />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/health" element={<Doctor />} />
        <Route path="/costs" element={<Costs />} />
        <Route path="/quota" element={<Quota />} />
        <Route path="/settings" element={<Settings />} />

        {/* Back-compat redirects from the pre-client-first routes */}
        <Route path="/overview" element={<Navigate to="/home" replace />} />
        <Route path="/dashboards" element={<Navigate to="/clients" replace />} />
        <Route path="/dashboards/:type/:id" element={<DashboardRedirect />} />
        <Route path="/opportunities" element={<Navigate to="/clients" replace />} />
        <Route path="/properties/:id" element={<PropertyConfigRedirect />} />
        <Route path="/doctor" element={<Navigate to="/health" replace />} />

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </AppShell>
  );
}
