/**
 * Async-event consumer for long-running demo operations.
 * Queue: antemortem-jobs. Body: { job: 'load-demo' | 'reset-demo', ...params }.
 */
import { Queue } from '@forge/events';
import { loadDemo, resetDemo } from './seed.js';

export const jobsQueue = new Queue({ key: 'antemortem-jobs' });

export async function jobsConsumer(event) {
  const body = event?.body ?? {};
  console.log('[antemortem] job', body.job);
  switch (body.job) {
    case 'load-demo':
      return loadDemo({ leadAccountId: body.leadAccountId });
    case 'reset-demo':
      return resetDemo();
    default:
      console.warn('[antemortem] unknown job', body);
      return { ok: false, error: 'unknown job' };
  }
}
