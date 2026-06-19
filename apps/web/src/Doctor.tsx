import { useEffect, useState } from 'react';
import { api, type DoctorResult } from './api';
import { Badge, Button, PageHeader, Spinner, Table, Td, Th } from './components/ui';

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
    <div>
      <PageHeader
        title="Health"
        description="Automated checks that your deployment is wired up and collecting."
        actions={
          <Button onClick={() => void run()} loading={running}>
            Re-run checks
          </Button>
        }
      />
      {error && <p className="mb-3 text-sm text-bad">{error}</p>}
      {!result ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Check</Th>
              <Th>Status</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {result.checks.map((c) => (
              <tr key={c.name}>
                <Td className="font-medium">{c.name}</Td>
                <Td>
                  <Badge tone={c.ok ? 'ok' : 'bad'}>{c.ok ? 'OK' : 'FAIL'}</Badge>
                </Td>
                <Td className="text-muted">{c.detail}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
