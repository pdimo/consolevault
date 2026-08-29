/**
 * "Open in Looker Studio" — the one-click Linking API handoff (SPEC §10), shared by Settings
 * (agency-wide) and a client's Configure tab (scoped to that client's properties).
 *
 * The two calculated fields are shown rather than buried in the docs on purpose: `ctr` and
 * `position` are ratios, and a BI tool left to its own devices will average them into numbers that
 * belong to no property and no day. Whoever clicks the button is the person who needs to paste
 * them, so they're one copy button away.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { api, type LookerTemplate } from '../api';
import { Button, Card, CopyField, Spinner } from './ui';

export default function LookerCard({
  target,
  className,
  children,
}: {
  /** Omit for the agency-wide report over every property. */
  target?: { type: string; id: string };
  className?: string;
  /** Extra controls rendered under the card (Settings puts the template-report field here). */
  children?: ReactNode;
}) {
  const targetType = target?.type;
  const targetId = target?.id;
  const [tpl, setTpl] = useState<LookerTemplate | null>(null);
  const [failed, setFailed] = useState(false);
  const [showFields, setShowFields] = useState(false);

  useEffect(() => {
    let live = true;
    setTpl(null);
    setFailed(false);
    api
      .lookerTemplate(targetType && targetId ? { type: targetType, id: targetId } : undefined)
      .then((t) => live && setTpl(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [targetType, targetId]);

  if (failed) return null;

  const scopeName = tpl?.scope?.name;
  return (
    <Card
      title="Looker Studio"
      {...(className ? { className } : {})}
      actions={
        tpl && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => window.open(tpl.url, '_blank', 'noopener')}
          >
            Open in Looker Studio
          </Button>
        )
      }
    >
      {!tpl ? (
        <div className="grid place-items-center py-6 text-muted">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {scopeName ? (
              <>
                Opens a Looker Studio report for <strong>{scopeName}</strong> with its data already
                bound — the query is scoped to this client&apos;s properties, so the link is safe to
                share with them.
              </>
            ) : (
              <>
                Opens a Looker Studio report in your own account with ConsoleVault&apos;s
                cross-property views already connected. The views are self-maintaining, so a
                property you add tomorrow appears without touching the report.
              </>
            )}{' '}
            {tpl.templateReportId
              ? 'Your template report is copied and repointed at this project.'
              : 'No template report is configured, so this creates a fresh report with the data sources ready — set one under Settings → Looker Studio to hand out a finished layout instead.'}
          </p>

          <ul className="mt-3 space-y-1 text-sm">
            {tpl.views.map((v) => (
              <li key={v.alias} className="flex flex-wrap gap-x-2 text-muted">
                <code className="text-fg">{v.viewId}</code>
                <span>— {v.grain}</span>
              </li>
            ))}
          </ul>

          {tpl.excluded.length > 0 && (
            <p className="mt-3 text-sm text-warn">
              Not included: {tpl.excluded.join(', ')} — a BigQuery-export property in another region
              lives outside the cross-property views. Its numbers still show in ConsoleVault&apos;s
              own reports.
            </p>
          )}

          <div className="mt-4">
            <Button size="sm" variant="ghost" onClick={() => setShowFields((s) => !s)}>
              {showFields ? 'Hide' : 'Show'} the calculated fields to add
            </Button>
            {showFields && (
              <div className="mt-2">
                <p className="text-sm text-muted">
                  Add these in Looker Studio (Resource → Manage added data sources → Add a field).
                  Summing or averaging <code>ctr</code> and <code>position</code> directly gives a
                  wrong answer at every level above a single row.
                </p>
                {tpl.calculatedFields.map((f) => (
                  <div key={f.name} className="mt-3">
                    <CopyField label={f.name} value={f.formula} />
                    <p className="mt-1 text-xs text-muted">{f.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {children && <div className="mt-5 border-t border-line pt-4">{children}</div>}
        </>
      )}
    </Card>
  );
}
