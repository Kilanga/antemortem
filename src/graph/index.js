import { RestGraphSource } from './RestGraphSource.js';

/**
 * Pick the graph source from settings. 'twg' and 'auto' fall back to REST
 * until TwgGraphSource lands (week 5, if the EAP is granted).
 */
export function graphSourceFor(settings) {
  switch (settings?.graphSource) {
    case 'twg':
    case 'auto':
    case 'rest':
    default:
      return new RestGraphSource();
  }
}
