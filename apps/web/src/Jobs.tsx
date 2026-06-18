import { useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@consolevault/types';
import { api, type LogRow } from './api';

const STATUSES: (TaskStatus | 'all')[] = [
  'all',
  'pending',
  'queued',
  'collected_with_data',
  'collected_no_data',
  'error',
];

function cell(v: { value: string } | string | null): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : v.value;
}

export default function Jobs() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<TaskStatus | 'all'>('error');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [queues, setQueues] = useState<{ name: string; state: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const loadTasks = (s: TaskStatus | 'all') =>
    api.tasks(s === 'all' ? {} : { status: s }).then(setTasks);

  useEffect(() => {
    void loadTasks(status);
  }, [status]);
  useEffect(() => {
    void api
      .logs()
      .then(setLogs)
      .catch(() => undefined);
    void api
      .queues()
      .then(setQueues)
      .catch(() => undefined);
  }, []);

  const run = async () => {
    setMsg('Starting…');
    try {
      const r = await api.runPipeline();
      setMsg(`Pipeline started: ${r.state}`);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const recollect = async (t: Task) => {
    await api.recollect(t.propertyId, t.dataDate, t.searchType, t.aggregation);
    await loadTasks(status);
  };

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Jobs</h2>
        <button className="primary" onClick={() => void run()}>
          Run pipeline now
        </button>
      </div>
      {msg && <p className="muted">{msg}</p>}

      <div className="card">
        <h3>Queues</h3>
        {queues.length === 0 ? (
          <p className="muted">No per-account queues yet.</p>
        ) : (
          <ul>
            {queues.map((q) => (
              <li key={q.name}>
                <code>{q.name}</code> — {q.state}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <strong>Tasks</strong>
        <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | 'all')}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="muted">{status === 'error' ? '(dead-letter)' : ''}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Type</th>
            <th>Agg</th>
            <th>Date</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.slice(0, 200).map((t) => (
            <tr key={t.id}>
              <td>{t.propertyId}</td>
              <td>{t.searchType}</td>
              <td>{t.aggregation}</td>
              <td>{t.dataDate}</td>
              <td>{t.status}</td>
              <td>
                <button onClick={() => void recollect(t)}>Re-collect</button>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No tasks for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent log</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Task</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 50).map((l, i) => (
              <tr key={i}>
                <td>{cell(l.logged_at)}</td>
                <td>
                  <code>{l.task_id}</code>
                </td>
                <td>{l.status}</td>
                <td>{l.row_count ?? ''}</td>
                <td className="error">{l.error_message ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
