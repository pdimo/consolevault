/**
 * ClientContent — the "Content & topics" tab: content groups (page-URL rules) and topic clusters
 * (query rules) that feed the report's grouped-entity panels. Target-scoped, so a rollup defines
 * its own groups spanning all member sites, exactly like a property does.
 */

import { useParams } from 'react-router-dom';
import { Card } from './components/ui';
import { SemanticGroupEditor } from './components/SemanticGroupEditor';

export default function ClientContent() {
  const { type = 'property', id = '' } = useParams();
  const scope = type === 'property' ? 'for this property' : "across this client's properties";
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Content groups">
        <p className="mb-3 text-sm text-muted">
          Group pages by URL rules (e.g. all <code>/blog/</code> pages) to analyse them together in
          the report — {scope}.
        </p>
        <SemanticGroupEditor targetType={type} targetId={id} kind="content" />
      </Card>
      <Card title="Topic clusters">
        <p className="mb-3 text-sm text-muted">
          Group queries by keyword rules (e.g. everything about “pricing”) to see topic-level
          performance — {scope}.
        </p>
        <SemanticGroupEditor targetType={type} targetId={id} kind="topic" />
      </Card>
    </div>
  );
}
