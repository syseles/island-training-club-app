import { assertEquals, assertRejects } from '@std/assert';
import { authoritativeSessionIsRetired } from './avatar-service.ts';

Deno.test('avatar service asks the authoritative session retirement RPC for exact session ids', async () => {
  const calls: Array<{ functionName: string; parameters: Record<string, string> }> = [];
  const retired = new Set([
    'hyrox-bft-2026-09-19',
    'hyrox-midtown-2026-09-19',
  ]);
  const rpc = (functionName: string, parameters: Record<string, string>) => {
    calls.push({ functionName, parameters });
    return Promise.resolve({
      data: retired.has(parameters.p_session_id),
      error: null,
    });
  };

  for (
    const [sessionId, expected] of [
      ['hyrox-bft-2026-09-19', true],
      ['hyrox-midtown-2026-09-19', true],
      ['hyrox-quarry-bay-2026-09-19', false],
      ['hyrox-bft-training-2026-09-19', false],
    ] as const
  ) {
    assertEquals(await authoritativeSessionIsRetired(sessionId, rpc), expected);
  }

  assertEquals(
    calls,
    [...retired, 'hyrox-quarry-bay-2026-09-19', 'hyrox-bft-training-2026-09-19']
      .map((sessionId) => ({
        functionName: 'operational_is_retired_hyrox_session',
        parameters: { p_session_id: sessionId },
      })),
  );
});

Deno.test('avatar service fails closed when authoritative retirement lookup fails', async () => {
  await assertRejects(
    () =>
      authoritativeSessionIsRetired(
        'hyrox-quarry-bay-2026-09-19',
        () => Promise.resolve({ data: null, error: { message: 'unavailable' } }),
      ),
    Error,
    'Session retirement lookup failed',
  );
});
