import { z } from 'zod';
import type { SignalsByAction, TemplateSet, TimekeeperTemplate } from '../timekeeper/templates';
import { EMPTY_SIGNALS } from '../timekeeper/templates';
import { probeFromStatus, type ProbeResult } from './client';
import { apiUrl, headersFor, type Credentials, type FetchLike } from './http';

/**
 * `GET /api/v1/timekeeper/templates` (server Phase S1). The data is
 * `TimekeeperTemplatesForClient()`: a list of templates, each with caps and signal
 * rows per action, texts translated by `Accept-Language`.
 */
const signalRow = z.object({ id: z.number().int(), time: z.number(), text: z.string() });
const template = z.object({
  id: z.number().int(),
  name: z.string(),
  caps: z.object({ half_time_cap: z.number(), time_cap: z.number() }),
  signals: z.record(z.string(), z.array(signalRow)),
});
const response = z.object({
  data: z.object({
    default_template_id: z.number().int(),
    templates: z.union([z.record(z.string(), template), z.array(template)]),
  }),
});

export function parseTemplates(json: unknown): TemplateSet | null {
  const parsed = response.safeParse(json);
  if (!parsed.success) return null;
  const { default_template_id: defaultTemplateId, templates } = parsed.data.data;
  const list = (Array.isArray(templates) ? templates : Object.values(templates)).map(
    (t): TimekeeperTemplate => {
      // Keep only the known action groups; unknown ones from a newer server are ignored.
      const signals: SignalsByAction = { ...EMPTY_SIGNALS };
      for (const key of Object.keys(EMPTY_SIGNALS) as (keyof SignalsByAction)[]) {
        signals[key] = t.signals[key] ?? [];
      }
      return { id: t.id, name: t.name, caps: t.caps, signals };
    },
  );
  return list.length ? { defaultTemplateId, templates: list } : null;
}

export type TemplatesResult =
  | { kind: 'ok'; set: TemplateSet }
  | { kind: 'absent' } // 404/405: the server predates S1; remember it and use the bundled defaults
  | { kind: 'unavailable' }; // network, auth or a bad body: try again later

export async function fetchTemplates(
  creds: Credentials,
  deps: { fetch?: FetchLike; language?: string; timeoutMs?: number } = {},
): Promise<TemplatesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
  try {
    const res = await (deps.fetch ?? fetch)(apiUrl(creds, '/timekeeper/templates'), {
      headers: headersFor(creds, deps.language ? { 'Accept-Language': deps.language } : {}),
      signal: controller.signal,
    });
    const probe: ProbeResult = probeFromStatus(res.status);
    if (probe === 'absent') return { kind: 'absent' };
    if (probe !== 'present') return { kind: 'unavailable' };
    const set = parseTemplates(await res.json().catch(() => null));
    return set ? { kind: 'ok', set } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
