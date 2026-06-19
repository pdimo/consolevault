import { useEffect, useState } from 'react';
import type { Task, TaskStatus } from '@consolevault/types';
import { api, type LogRow } from './api';
import { useToast } from './components/feedback';
import { Badge, Button, Card, PageHeader, Select, Table, Td, Th } from './components/ui';

const STATUSES: (TaskStatus | 'all')[] = [
  'all',
  'pending',
  'queued',
  'collected_with_data',
  'collected_no_data',
  'error',
];

type Tone = NonNullable<Parameters<typeof Badge>[0]['tone']>;
const STATUS_TONE: Record<string, Tone> = {
  collected_with_data: 'ok',
  collected_fresh: 'fresh',
  collected_no_data: 'neutral',
  pending: 'warn',
  queued: 'warn',
  skipped: 'accent',
  error: 'bad',
};

function cell(v: { value: string } | string | null): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : v.value;
}

export default function Jobs() {
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<TaskStatus | 'all'>('error');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [queues, setQueues] = useState<{ name: string; state: string }[]>([]);
  const [running, setRunning] = useState(false);

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
    setRunning(true);
    try {
      const r = await api.runPipeline();
      toast(`Pipeline started: ${r.state}`, 'success');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setRunning(false);
    }
  };

  const recollect = async (t: Task) => {
    await api.recollect(t.propertyId, t.dataDate, t.searchType, t.aggregation);
    toast('Re-collection queued', 'success');
    await loadTasks(status);
  };

  const requeueErrors = async () => {
    try {
      const r = await api.requeueErrors();
      toast(`Requeued ${r.requeued} error task(s). Run the pipeline to collect them.`, 'success');
      await loadTasks(status);
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader
        title="Jobs"
        description="Collection runs, per-account queues, and recent attempts."
        actions={
          <>
            <Button onClick={() => void requeueErrors()}>Requeue all errors</Button>
            <Button variant="primary" loading={running} onClick={() => void run()}>
              Run pipeline now
            </Button>
          </>
        }
      />

      <Card title="Queues" className="mb-5">
        {queues.length === 0 ? (
          <p className="text-sm text-muted">No per-account queues yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {queues.map((q) => (
              <span key={q.name} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
                <code>{q.name}</code> · {q.state}
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-3 flex items-center gap-3">
        <span className="font-semibold">Tasks</span>
        <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | 'all')}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {status === 'error' && <Badge tone="bad">dead-letter</Badge>}
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Property</Th>
            <Th>Type</Th>
            <Th>Agg</Th>
            <Th>Date</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {tasks.slice(0, 200).map((t) => (
            <tr key={t.id} className="hover:bg-surface-2/50">
              <Td className="font-mono text-xs">{t.propertyId}</Td>
              <Td>{t.searchType}</Td>
              <Td>{t.aggregation}</Td>
              <Td>{t.dataDate}</Td>
              <Td>
                <Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status}</Badge>
              </Td>
              <Td>
                <Button size="sm" onClick={() => void recollect(t)}>
                  Re-collect
                </Button>
              </Td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <Td className="px-3 py-6 text-muted">No tasks for this filter.</Td>
            </tr>
          )}
        </tbody>
      </Table>

      <Card title="Recent log" className="mt-5" bodyClassName="p-0">
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Task</Th>
              <Th>Status</Th>
              <Th>Rows</Th>
              <Th>Error</Th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 50).map((l, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap text-muted">{cell(l.logged_at)}</Td>
                <Td className="font-mono text-xs">{l.task_id}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{l.status}</Badge>
                </Td>
                <Td>{l.row_count ?? ''}</Td>
                <Td className="text-bad">{l.error_message ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
