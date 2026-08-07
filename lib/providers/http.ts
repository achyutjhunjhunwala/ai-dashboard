export async function fetchJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body ? `: ${body.slice(0, 240)}` : '';
    throw new Error(`${response.status} ${response.statusText}${detail}`);
  }

  return (await response.json()) as T;
}
