import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisConnection } from '../src/config/redis.js';
import { getHourWindowInfo, tryAcquireSendSlot } from '../src/services/rateLimiterService.js';

const testRedis = createRedisConnection('test-ratelimiter');
const TEST_SENDER_ID = '00000000-0000-4000-8000-000000000001';

async function clearTestRateLimitKeys() {
  const keys = await testRedis.keys('ratelimit:*');
  if (keys.length > 0) {
    await testRedis.del(...keys);
  }
}

describe('Atomic Redis Rate Limiter (Per-Sender, Global & Min Delay)', () => {
  beforeEach(async () => {
    await clearTestRateLimitKeys();
  });

  afterAll(async () => {
    await clearTestRateLimitKeys();
    await testRedis.quit();
  });

  it('enforces per-sender hourly cap and reschedules overflow cleanly to next hour window with staggered slots', async () => {
    const baseMs = 1_760_000_100_000;
    const { nextHourStartMs } = getHourWindowInfo(baseMs);

    const first = await tryAcquireSendSlot(testRedis, {
      senderId: TEST_SENDER_ID,
      senderHourlyLimit: 2,
      minDelayMs: 0,
      nowMs: baseMs,
    });
    expect(first.status).toBe('ALLOWED');

    const second = await tryAcquireSendSlot(testRedis, {
      senderId: TEST_SENDER_ID,
      senderHourlyLimit: 2,
      minDelayMs: 0,
      nowMs: baseMs + 100,
    });
    expect(second.status).toBe('ALLOWED');

    // 3rd and 4th hits exceed limit (2/hr) and should get distinct staggered slots in next hour
    const third = await tryAcquireSendSlot(testRedis, {
      senderId: TEST_SENDER_ID,
      senderHourlyLimit: 2,
      minDelayMs: 1000,
      nowMs: baseMs + 200,
    });
    const fourth = await tryAcquireSendSlot(testRedis, {
      senderId: TEST_SENDER_ID,
      senderHourlyLimit: 2,
      minDelayMs: 1000,
      nowMs: baseMs + 300,
    });

    expect(third.status).toBe('RATE_LIMITED');
    expect(fourth.status).toBe('RATE_LIMITED');
    if (third.status === 'RATE_LIMITED' && fourth.status === 'RATE_LIMITED') {
      expect(third.retryAtMs).toBe(nextHourStartMs);
      expect(fourth.retryAtMs).toBeGreaterThan(third.retryAtMs);
      expect(fourth.retryAtMs - third.retryAtMs).toBeGreaterThanOrEqual(1000);
    }
  });

  it('enforces minimum delay spacing safely across parallel concurrent calls without consuming hourly quota on delayed checks', async () => {
    const nowMs = 1_760_000_200_000;

    const results = await Promise.all([
      tryAcquireSendSlot(testRedis, {
        senderId: TEST_SENDER_ID,
        senderHourlyLimit: 10,
        minDelayMs: 2500,
        nowMs,
      }),
      tryAcquireSendSlot(testRedis, {
        senderId: TEST_SENDER_ID,
        senderHourlyLimit: 10,
        minDelayMs: 2500,
        nowMs,
      }),
      tryAcquireSendSlot(testRedis, {
        senderId: TEST_SENDER_ID,
        senderHourlyLimit: 10,
        minDelayMs: 2500,
        nowMs,
      }),
    ]);

    const allowed = results.filter((r) => r.status === 'ALLOWED');
    const delayed = results.filter((r) => r.status === 'DELAY_SPACING');

    expect(allowed).toHaveLength(1);
    expect(delayed).toHaveLength(2);

    if (delayed[0]?.status === 'DELAY_SPACING' && delayed[1]?.status === 'DELAY_SPACING') {
      const retryTimes = [delayed[0].retryAtMs, delayed[1].retryAtMs].sort((a, b) => a - b);
      expect(retryTimes[0]).toBe(nowMs + 2500);
      expect(retryTimes[1]).toBe(nowMs + 5000);
    }
  });

  it('keeps independent hourly buckets across multiple senders', async () => {
    const nowMs = 1_760_000_300_000;
    const senderA = '00000000-0000-4000-8000-0000000000aa';
    const senderB = '00000000-0000-4000-8000-0000000000bb';

    const hitA1 = await tryAcquireSendSlot(testRedis, {
      senderId: senderA,
      senderHourlyLimit: 1,
      minDelayMs: 0,
      nowMs,
    });
    const hitA2 = await tryAcquireSendSlot(testRedis, {
      senderId: senderA,
      senderHourlyLimit: 1,
      minDelayMs: 0,
      nowMs,
    });
    const hitB1 = await tryAcquireSendSlot(testRedis, {
      senderId: senderB,
      senderHourlyLimit: 1,
      minDelayMs: 0,
      nowMs,
    });

    expect(hitA1.status).toBe('ALLOWED');
    expect(hitA2.status).toBe('RATE_LIMITED');
    expect(hitB1.status).toBe('ALLOWED');
  });
});
