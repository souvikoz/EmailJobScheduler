import type { Redis } from 'ioredis';
import { env } from '../config/env.js';

export type RateLimitDecision =
  | {
      status: 'ALLOWED';
      hourBucket: string;
      senderCount: number;
      globalCount: number;
      nextAllowedMs: number;
    }
  | {
      status: 'DELAY_SPACING';
      retryAtMs: number;
      reason: string;
    }
  | {
      status: 'RATE_LIMITED';
      scope: 'sender' | 'global';
      hourBucket: string;
      currentCount: number;
      limit: number;
      retryAtMs: number;
      reason: string;
    };

/**
 * Atomic Redis Lua script executed across all distributed worker instances:
 * 1. Checks per-sender hourly bucket counter against senderLimit.
 * 2. Checks global hourly bucket counter against globalLimit.
 * 3. Checks minimum per-sender inter-email delay using nextAllowedMs + reservedDelayUntilMs
 *    so concurrent workers reserve non-overlapping future slots instead of colliding.
 * 4. If either hourly limit is exceeded, computes a staggered timestamp in the next UTC hour
 *    using a next-hour slot counter (preserving order and avoiding a :00 thundering herd).
 * 5. Only increments hourly counters when the send slot is actually granted!
 */
const ACQUIRE_SEND_SLOT_LUA = `
local senderHourKey = KEYS[1]
local globalHourKey = KEYS[2]
local spacingNextKey = KEYS[3]
local spacingReservedKey = KEYS[4]
local nextHourSlotKey = KEYS[5]

local nowMs = tonumber(ARGV[1])
local senderLimit = tonumber(ARGV[2])
local globalLimit = tonumber(ARGV[3])
local minDelayMs = tonumber(ARGV[4])
local nextHourStartMs = tonumber(ARGV[5])
local hourTtlSec = tonumber(ARGV[6])

local senderCount = tonumber(redis.call('GET', senderHourKey) or '0')
local globalCount = tonumber(redis.call('GET', globalHourKey) or '0')

if senderCount >= senderLimit then
  local slot = redis.call('INCR', nextHourSlotKey)
  if slot == 1 then
    redis.call('EXPIRE', nextHourSlotKey, hourTtlSec)
  end
  local staggerMs = math.max(minDelayMs, 250)
  local retryAtMs = nextHourStartMs + ((slot - 1) * staggerMs)
  return { 'RATE_LIMITED', 'sender', tostring(senderCount), tostring(senderLimit), tostring(retryAtMs) }
end

if globalCount >= globalLimit then
  local slot = redis.call('INCR', nextHourSlotKey)
  if slot == 1 then
    redis.call('EXPIRE', nextHourSlotKey, hourTtlSec)
  end
  local staggerMs = math.max(minDelayMs, 250)
  local retryAtMs = nextHourStartMs + ((slot - 1) * staggerMs)
  return { 'RATE_LIMITED', 'global', tostring(globalCount), tostring(globalLimit), tostring(retryAtMs) }
end

if minDelayMs > 0 then
  local nextAllowedMs = tonumber(redis.call('GET', spacingNextKey) or '0')
  if nowMs < nextAllowedMs then
    local reservedUntilMs = tonumber(redis.call('GET', spacingReservedKey) or '0')
    local slotMs = math.max(nextAllowedMs, reservedUntilMs)
    local nextReservedMs = slotMs + minDelayMs
    redis.call('SET', spacingReservedKey, tostring(nextReservedMs), 'PX', math.max(minDelayMs * 10, 60000))
    return { 'DELAY_SPACING', tostring(slotMs) }
  end
end

local newSenderCount = redis.call('INCR', senderHourKey)
if newSenderCount == 1 then
  redis.call('EXPIRE', senderHourKey, hourTtlSec)
end

local newGlobalCount = redis.call('INCR', globalHourKey)
if newGlobalCount == 1 then
  redis.call('EXPIRE', globalHourKey, hourTtlSec)
end

local nextAllowed = nowMs + minDelayMs
if minDelayMs > 0 then
  redis.call('SET', spacingNextKey, tostring(nextAllowed), 'PX', math.max(minDelayMs * 10, 60000))
end

return { 'ALLOWED', tostring(newSenderCount), tostring(newGlobalCount), tostring(nextAllowed) }
`;

export function getHourWindowInfo(nowMs: number): {
  hourBucket: string;
  nextHourBucket: string;
  nextHourStartMs: number;
} {
  const hourIndex = Math.floor(nowMs / 3_600_000);
  const nextHourIndex = hourIndex + 1;
  return {
    hourBucket: String(hourIndex),
    nextHourBucket: String(nextHourIndex),
    nextHourStartMs: nextHourIndex * 3_600_000,
  };
}

export async function tryAcquireSendSlot(
  redis: Redis,
  params: {
    senderId: string;
    senderHourlyLimit?: number | null;
    minDelayMs?: number | null;
    nowMs?: number;
  }
): Promise<RateLimitDecision> {
  const nowMs = params.nowMs ?? Date.now();
  const senderLimit = Math.max(1, params.senderHourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER);
  const globalLimit = Math.max(1, env.MAX_EMAILS_PER_HOUR_GLOBAL);
  const minDelayMs = Math.max(0, params.minDelayMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS);

  const { hourBucket, nextHourBucket, nextHourStartMs } = getHourWindowInfo(nowMs);

  const keys = [
    `ratelimit:hour:sender:${params.senderId}:${hourBucket}`,
    `ratelimit:hour:global:${hourBucket}`,
    `ratelimit:spacing:sender:${params.senderId}`,
    `ratelimit:spacing:reserved:${params.senderId}`,
    `ratelimit:nextslot:sender:${params.senderId}:${nextHourBucket}`,
  ];

  const raw = (await redis.eval(
    ACQUIRE_SEND_SLOT_LUA,
    keys.length,
    ...keys,
    String(nowMs),
    String(senderLimit),
    String(globalLimit),
    String(minDelayMs),
    String(nextHourStartMs),
    '7500'
  )) as string[];

  const tag = raw[0];
  if (tag === 'ALLOWED') {
    return {
      status: 'ALLOWED',
      hourBucket,
      senderCount: Number(raw[1]),
      globalCount: Number(raw[2]),
      nextAllowedMs: Number(raw[3]),
    };
  }

  if (tag === 'DELAY_SPACING') {
    const retryAtMs = Number(raw[1]);
    return {
      status: 'DELAY_SPACING',
      retryAtMs,
      reason: `Enforcing minimum ${minDelayMs}ms inter-email delay`,
    };
  }

  const scope = raw[1] === 'global' ? 'global' : 'sender';
  const currentCount = Number(raw[2]);
  const limit = Number(raw[3]);
  const retryAtMs = Number(raw[4]);
  return {
    status: 'RATE_LIMITED',
    scope,
    hourBucket,
    currentCount,
    limit,
    retryAtMs,
    reason:
      scope === 'sender'
        ? `Sender hourly limit reached (${currentCount}/${limit}); rescheduled to next hour window`
        : `Global hourly limit reached (${currentCount}/${limit}); rescheduled to next hour window`,
  };
}

export async function getRateLimitStatus(redis: Redis, senderId: string, nowMs = Date.now()): Promise<{
  hourBucket: string;
  senderUsed: number;
  globalUsed: number;
  defaultSenderLimit: number;
  globalLimit: number;
  minDelayMs: number;
}> {
  const { hourBucket } = getHourWindowInfo(nowMs);
  const [senderRaw, globalRaw] = await redis.mget(
    `ratelimit:hour:sender:${senderId}:${hourBucket}`,
    `ratelimit:hour:global:${hourBucket}`
  );
  return {
    hourBucket,
    senderUsed: Number(senderRaw ?? '0'),
    globalUsed: Number(globalRaw ?? '0'),
    defaultSenderLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    globalLimit: env.MAX_EMAILS_PER_HOUR_GLOBAL,
    minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
  };
}
