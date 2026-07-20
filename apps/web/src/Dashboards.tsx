import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardListItem } from '@consolevault/types';
import { api } from './api';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from './components/ui';

export default function Dashboards() {
  const [list, setList] = useState<DashboardListItem[] | null>(null);

  useEffect(() => {
    api
      .listDashboards()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  if (!list) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboards"
        description="Explore your Search Console data. Enable a dashboard on a property or group to see it here."
      />

      {list.length === 0 ? (
        <EmptyState
          icon="▤"
          title="No dashboards yet"
          description="Turn on “Dashboard” for a property (Properties → a property) or a group (Groups) to surface an analytics dashboard here."
          action={
            <Link to="/properties">
              <Button variant="primary">Go to Properties</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => (
            <Link key={`${d.type}:${d.id}`} to={`/dashboards/${d.type}/${d.id}`}>
              <Card className="h-full transition-colors hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <p className="break-all font-medium">{d.name}</p>
                  <Badge tone={d.type === 'group' ? 'accent' : 'neutral'}>{d.type}</Badge>
                </div>
                <p className="mt-3 text-sm text-accent">Open dashboard →</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
