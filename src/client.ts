/**
 * Core HTTP client for the Econt JSON services API.
 *
 * Econt exposes its e-commerce API as JSON-over-POST "services":
 *   production: https://ee.econt.com/services
 *   sandbox:    https://demo.econt.com/ee/services  (the Demo environment)
 *
 * Auth is HTTP Basic with the credentials of an Econt client profile.
 * The sandbox accepts the demo account credentials issued by Econt.
 */

const ECONT_DEMO_URL = 'https://demo.econt.com/ee/services';
const ECONT_PROD_URL = 'https://ee.econt.com/services';

export interface EcontConfig {
  username: string;
  password: string;
  /** true = Econt Demo environment. Default false (production). */
  sandbox?: boolean;
  /** Override fetch (tests, custom agents). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export type EcontResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function headers(config: EcontConfig): Record<string, string> {
  const credentials = Buffer.from(
    `${config.username}:${config.password}`,
  ).toString('base64');
  return {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
  };
}

export function baseUrl(config: EcontConfig): string {
  return config.sandbox ? ECONT_DEMO_URL : ECONT_PROD_URL;
}

/**
 * One POST to an Econt service. Never throws: transport failures, non-2xx
 * statuses and non-JSON bodies all come back as `{ ok: false, error }`, so a
 * caller has exactly one failure channel to handle.
 */
export async function postEcont<T>(
  config: EcontConfig,
  path: string,
  body: unknown,
): Promise<EcontResult<T>> {
  const url = `${baseUrl(config)}${path}`;
  const fetchImpl = config.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Econt ${res.status}: ${text || res.statusText}` };
    }
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, error: 'Econt returned non-JSON response' };
    }
    return { ok: true, data: parsed as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error contacting Econt',
    };
  }
}

type EcontProfileResponse = {
  client?: { name?: string };
  clients?: Array<{ name?: string }>;
};

/**
 * Cheapest authenticated call — use it to verify credentials before saving
 * them. Returns the client profile name Econt knows the account by.
 */
export async function testConnection(config: EcontConfig): Promise<{
  success: boolean;
  clientName?: string;
  error?: string;
}> {
  const res = await postEcont<EcontProfileResponse>(
    config,
    '/Profile/ProfileService.getClientProfiles.json',
    { includeClientProfiles: true },
  );
  if (!res.ok) return { success: false, error: res.error };
  const name =
    res.data.client?.name ?? res.data.clients?.[0]?.name ?? config.username;
  return { success: true, clientName: name };
}
