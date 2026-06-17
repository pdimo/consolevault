/**
 * ConsoleVault Cloud Run workers — discover, collector, log-writer.
 *
 * Stage 0: STUB. No worker is wired and NO data is collected (CLAUDE.md hard rule 3).
 * This module exists so the workspace compiles and downstream stages have a home.
 * The collector (SPEC §5.2) and discovery (SPEC §5.1) land in Stages 1–3.
 */

/** Identifiers for the three workers this app will host. */
export const WORKER_NAMES = ['discover', 'collector', 'log-writer'] as const;
export type WorkerName = (typeof WORKER_NAMES)[number];
