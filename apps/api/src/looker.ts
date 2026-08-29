/**
 * Looker Studio template links (SPEC §10). One read-only route that hands the UI a Linking API URL
 * for this deployment — agency-wide, or scoped to a single client/rollup/property.
 *
 * All of the URL construction lives in `@consolevault/bq`; this layer only resolves "which property
 * tables does this target mean" from Firestore and reads the configured template report id.
 */

import type { FastifyInstance } from 'fastify';
import {
  buildLookerTemplateUrl,
  buildTemplateDatasources,
  LOOKER_CALCULATED_FIELDS,
  LOOKER_REPORT_NAME,
  LOOKER_TEMPLATE_VIEWS,
} from '@consolevault/bq';
import type { Property } from '@consolevault/types';
import { clientRepo, config, groupRepo, propertyRepo, settingsRepo } from './deps.js';
import { HttpError } from './errors.js';

interface Scope {
  type: string;
  id: string;
  name: string;
  properties: Property[];
}

/**
 * A cross-region native-export property's data stays in a region-local landing dataset (SPEC §12),
 * so it is not part of the `_all` views a Looker report reads. Its rows are reachable in the app's
 * own reports but not through this link — name it rather than let the report quietly under-count.
 */
function unreachable(p: Property): boolean {
  return (
    p.source === 'native_export' &&
    Boolean(p.exportLocation) &&
    p.exportLocation?.toUpperCase() !== config.bqLocation.toUpperCase()
  );
}

async function resolveScope(type: string, id: string): Promise<Scope> {
  if (type === 'property') {
    const p = await propertyRepo.get(id);
    if (!p) throw new HttpError(404, 'Property not found');
    return { type, id, name: p.siteUrl, properties: [p] };
  }
  if (type === 'client') {
    const client = await clientRepo.get(id);
    if (!client) throw new HttpError(404, 'Client not found');
    return { type, id, name: client.name, properties: await propertyRepo.listByClient(id) };
  }
  if (type === 'group') {
    const g = await groupRepo.get(id);
    if (!g) throw new HttpError(404, 'Rollup not found');
    const members = (await Promise.all(g.memberPropertyIds.map((m) => propertyRepo.get(m)))).filter(
      (m): m is Property => Boolean(m),
    );
    return { type, id, name: g.name, properties: members };
  }
  throw new HttpError(400, `Unknown target type: ${type}`);
}

export function registerLookerRoutes(app: FastifyInstance): void {
  // The link for a target. No `type`/`id` = the agency-wide report over every property.
  app.get('/api/looker/template', async (req) => {
    const { type, id } = req.query as { type?: string; id?: string };
    const settings = await settingsRepo.get();
    const scope = type && id ? await resolveScope(type, id) : null;

    const reachable = (scope?.properties ?? []).filter((p) => !unreachable(p));
    const sourceTables = reachable.map((p) => p.sanitizedTableName);

    return {
      projectId: config.projectId,
      templateReportId: settings.lookerTemplateReportId ?? '',
      scope: scope ? { type: scope.type, id: scope.id, name: scope.name, sourceTables } : null,
      excluded: (scope?.properties ?? []).filter(unreachable).map((p) => p.siteUrl),
      views: LOOKER_TEMPLATE_VIEWS,
      calculatedFields: LOOKER_CALCULATED_FIELDS,
      url: buildLookerTemplateUrl({
        projectId: config.projectId,
        datasources: buildTemplateDatasources(config.projectId, {
          sourceTables,
          months: settings.defaultBackfillMonths,
        }),
        reportName: scope ? `${LOOKER_REPORT_NAME} — ${scope.name}` : LOOKER_REPORT_NAME,
        ...(settings.lookerTemplateReportId
          ? { templateReportId: settings.lookerTemplateReportId }
          : {}),
      }),
    };
  });
}
