import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { credentialsFor } from '../services/session';
import { refreshTemplates } from '../services/templates';
import { getRepo } from '../store/sqlite';
import { BUNDLED_TEMPLATES, type TemplateSet } from './templates';

/**
 * Template source order: server (fetched when online, cached after) -> cached copy ->
 * bundled WFDF defaults. Without a server, or with nothing cached, the bundled
 * defaults are used, and the Timekeeper works fully offline.
 */
export function useTemplates(serverId?: number): TemplateSet {
  const [templates, setTemplates] = useState<TemplateSet>(BUNDLED_TEMPLATES);
  // Refetched when the language changes in Settings, for the server's translated names.
  const { language } = useTranslation().i18n;
  useEffect(() => {
    let live = true;
    void (async () => {
      const repo = await getRepo();
      const ids = serverId !== undefined ? [serverId] : (await repo.listServers()).map((s) => s.id);
      for (const id of ids) {
        const cached = await repo.getCachedTemplates(id);
        if (cached?.templates.length) {
          if (live) setTemplates(cached);
          break;
        }
      }
      // Refresh in the background; the cached or bundled set is already showing.
      for (const id of ids) {
        const creds = await credentialsFor(id);
        if (!creds) continue;
        const fresh = await refreshTemplates({
          repo,
          serverId: id,
          creds,
          language,
        });
        if (fresh?.templates.length && live) {
          setTemplates(fresh);
          break;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [serverId, language]);
  return templates;
}
