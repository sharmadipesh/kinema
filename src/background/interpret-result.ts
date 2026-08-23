import type { GlobalContext, ModelEvent, Reconciliation } from '../services/validate-motion.ts';

/**
 * What one round of interpretation produced.
 *
 * Its own module so `artifacts.ts` can persist it without importing the
 * orchestrator, which imports artifacts — a cycle that TypeScript tolerates and
 * bundlers resolve unpredictably.
 */
export interface InterpretResult {
  events: ModelEvent[];
  global?: GlobalContext;
  reconciliation?: Reconciliation;
  calls: number;
  globalFrames: number;
  localOnly?: boolean;
}
