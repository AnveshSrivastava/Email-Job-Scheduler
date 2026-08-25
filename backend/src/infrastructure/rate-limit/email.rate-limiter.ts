import { getRedisConnection } from '../queue/queue.connection';
import { config } from '../../config/env';

export interface RateLimitResult {
  allowed: boolean;
  nextAllowedTimeMs?: number;
}

const rateLimitLuaScript = `
local capacityKey = KEYS[1]
local delayKey = KEYS[2]

local maxCapacity = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local nextHourWindowMs = tonumber(ARGV[4])

local currentCount = tonumber(redis.call('GET', capacityKey) or '0')
if currentCount >= maxCapacity then
    return {0, nextHourWindowMs}
end

local nextAllowedTime = tonumber(redis.call('GET', delayKey) or '0')
if nowMs < nextAllowedTime then
    return {0, nextAllowedTime}
end

redis.call('INCR', capacityKey)
if currentCount == 0 then
    redis.call('EXPIRE', capacityKey, 7200)
end

local newNextAllowed = nowMs + minDelayMs
redis.call('SET', delayKey, tostring(newNextAllowed))
redis.call('PEXPIRE', delayKey, minDelayMs * 2)

return {1, newNextAllowed}
`;

export class EmailRateLimiter {
  private redis = getRedisConnection();
  private scriptSha: string | null = null;

  private async loadScript(): Promise<string> {
    if (!this.scriptSha) {
      this.scriptSha = (await this.redis.script('LOAD', rateLimitLuaScript)) as string;
    }
    return this.scriptSha;
  }

  public async reserveSendSlot(
    senderId: string,
    now: Date = new Date(),
    maxHourlyCapacity: number = config.MAX_EMAILS_PER_HOUR_PER_SENDER,
    minDelayMs: number = config.MIN_EMAIL_DELAY_MS,
  ): Promise<RateLimitResult> {
    const nowMs = now.getTime();

    // Calculate current hour window string
    const currentHourString = now.toISOString().substring(0, 13); // e.g., "2026-08-25T20"

    // Calculate next hour window ms
    const nextHour = new Date(now);
    nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
    const nextHourWindowMs = nextHour.getTime();

    const capacityKey = `email-rate:${senderId}:${currentHourString}`;
    const delayKey = `sender-throttle:${senderId}:next`;

    const sha = await this.loadScript();

    const result = (await this.redis.evalsha(
      sha,
      2,
      capacityKey,
      delayKey,
      maxHourlyCapacity,
      minDelayMs,
      nowMs,
      nextHourWindowMs,
    )) as [number, number];

    const allowed = result[0] === 1;
    const nextAllowedTimeMs = result[1];

    return {
      allowed,
      nextAllowedTimeMs,
    };
  }
}
