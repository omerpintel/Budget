export interface OllamaStatus {
  reachable: boolean;
  models: string[];
  error?: string;
}

export async function checkOllama(baseUrl: string, signal?: AbortSignal): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal });
    if (!res.ok) return { reachable: false, models: [], error: `HTTP ${res.status}` };
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    return { reachable: true, models: (body.models ?? []).map((m) => m.name) };
  } catch (err) {
    return {
      reachable: false,
      models: [],
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
