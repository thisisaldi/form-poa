/**
 * Helper to perform HTTP fetch with a strict timeout guard.
 * Defaults to 60000ms (60 seconds).
 */
export async function fetchWithTimeout(
  url: string | URL,
  init?: RequestInit,
  timeoutMs = 60000
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal
    ? (AbortSignal as any).any
      ? (AbortSignal as any).any([init.signal, timeoutSignal])
      : timeoutSignal
    : timeoutSignal;

  return fetch(url, {
    ...init,
    signal,
  });
}
