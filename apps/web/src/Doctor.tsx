import { useEffect, useState } from 'react';
import { api, type DoctorResult } from './api';

export default function Doctor() {
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await api.doctor());
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    void run();
  }, []);

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Verify setup</h2>
        <button onClick={() => void run()} disabled={running}>
          {running ? 'Checking…' : 'Re-run checks'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th></th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {result.checks.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>
                  <span
                    className="badge"
                    style={{ background: c.ok ? 'var(--green)' : 'var(--red)' }}
                  >
                    {c.ok ? 'OK' : 'FAIL'}
                  </span>
                </td>
                <td className="muted">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
