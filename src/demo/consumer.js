/**
 * Async-event consumer for long-running demo operations.
 * Queue: antemortem-jobs. Body: { job: 'load-demo' | 'reset-demo', ...params }.
 */
import { Queue } from '@forge/events';
import { loadDemo, resetDemo } from './seed.js';
import { runAnalysis } from '../engine/index.js';

export const jobsQueue = new Queue({ key: 'antemortem-jobs' });

export async function jobsConsumer(event) {
  const body = event?.body ?? {};
  console.log('[antemortem] job', body.job);
  switch (body.job) {
    case 'load-demo':
      return loadDemo({ leadAccountId: body.leadAccountId });
    case 'reset-demo':
      return resetDemo();
    case 'run-analysis':
      // Analysis publishes pages and creates issues: too slow for a 25 s
      // resolver, so the UI queues it here and polls analysis_run.
      return runAnalysis({ source: body.source ?? 'manual' });
    default:
      console.warn('[antemortem] unknown job', body);
      return { ok: false, error: 'unknown job' };
  }
}
