/**
 * Health handler.
 *
 * Stage 0: a static liveness probe — no Firestore/BigQuery/Secret Manager checks yet.
 * The richer "Verify my setup" doctor check (SPEC §10) lands in a later stage.
 */

export interface HealthResponse {
  status: 'ok';
  service: string;
  stage: number;
}

export function getHealth(): HealthResponse {
  return { status: 'ok', service: 'consolevault-api', stage: 2 };
}
