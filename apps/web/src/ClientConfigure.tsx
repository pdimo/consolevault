/**
 * ClientConfigure — the "Configure" tab dispatcher. Both client kinds share the `configure` route;
 * a property configures collection (the embedded Property page), a rollup configures how it reports.
 */

import { useParams } from 'react-router-dom';
import Property from './Property';
import RollupConfigure from './RollupConfigure';
import ClientConfigureView from './ClientConfigureView';

export default function ClientConfigure() {
  const { type } = useParams();
  if (type === 'client') return <ClientConfigureView />;
  if (type === 'group') return <RollupConfigure />;
  return <Property embedded />;
}
