import { fetchTemplates, type TemplatesResult } from '../api/templates';
import type { Credentials, FetchLike } from '../api/http';
import type { Repo } from '../store/repo';
import type { TemplateSet } from '../timekeeper/templates';

export const TEMPLATES_ROUTE = 'timekeeper/templates';

/**
 * Refreshes the cached templates of a server. The route is probed once: a 404 is
 * remembered, so a server without S1 is not asked again; any other failure is retried
 * next time. Returns the set to use, or null for "use the bundled defaults".
 */
export async function refreshTemplates(deps: {
  repo: Repo;
  serverId: number;
  creds: Credentials;
  language?: string;
  fetch?: FetchLike;
}): Promise<TemplateSet | null> {
  const probes = await deps.repo.getProbes(deps.serverId);
  if (probes[TEMPLATES_ROUTE] === 'absent') return null;
  const res: TemplatesResult = await fetchTemplates(deps.creds, {
    language: deps.language,
    fetch: deps.fetch,
  });
  if (res.kind === 'absent') {
    await deps.repo.setProbe(deps.serverId, TEMPLATES_ROUTE, 'absent');
    return null;
  }
  if (res.kind === 'ok') {
    await deps.repo.setProbe(deps.serverId, TEMPLATES_ROUTE, 'present');
    await deps.repo.setCachedTemplates(deps.serverId, res.set);
    return res.set;
  }
  return deps.repo.getCachedTemplates(deps.serverId);
}
