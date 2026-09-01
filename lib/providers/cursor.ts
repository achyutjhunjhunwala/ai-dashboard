import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow } from '../dates';
import type { ProviderUsage } from '../types';
import { calculateDailySpend } from './daily';
import type { ProviderAdapter } from './types';

const cursorUsagePath = path.join(process.cwd(), 'data', 'cursor-usage.json');

type CursorUsageData = {
  requestsUsed: number;
  requestsTotal: number;
  resetsAt: string;
};

interface CursorSummaryInput {
  billingCycleStart?: string | null;
  billingCycleEnd?: string | null;
  individualUsage?: {
    overall?: {
      enabled?: boolean | null;
      used?: number | null;
      limit?: number | null;
      remaining?: number | null;
    } | null;
  } | null;
  fastUsage?: number | null;
  premiumUsage?: number | null;
  usage?: number | null;
  used?: number | null;
  planUsage?: number | null;
  fastLimit?: number | null;
  premiumLimit?: number | null;
  limit?: number | null;
  max?: number | null;
  resetDate?: string | null;
  resetsAt?: string | null;
  reset_at?: string | null;
}

function extractCursorSummaryMetrics(data: CursorSummaryInput | null | undefined): {
  requestsUsed: number;
  requestsTotal: number;
  resetsAt: string;
} {
  let requestsUsed = 0;
  let requestsTotal = 100000;
  let resetsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 day default fallback

  if (data) {
    // 1. Used Requests (Check nested individualUsage first, then general fallbacks)
    const indOverall = data.individualUsage?.overall;
    if (indOverall) {
      if (typeof indOverall.used === 'number') requestsUsed = indOverall.used;
      if (typeof indOverall.limit === 'number') requestsTotal = indOverall.limit;
    } else {
      if (typeof data.fastUsage === 'number') requestsUsed = data.fastUsage;
      else if (typeof data.premiumUsage === 'number') requestsUsed = data.premiumUsage;
      else if (typeof data.planUsage === 'number') requestsUsed = data.planUsage;
      else if (typeof data.used === 'number') requestsUsed = data.used;
      else if (typeof data.usage === 'number') requestsUsed = data.usage;

      if (typeof data.fastLimit === 'number') requestsTotal = data.fastLimit;
      else if (typeof data.premiumLimit === 'number') requestsTotal = data.premiumLimit;
      else if (typeof data.limit === 'number') requestsTotal = data.limit;
      else if (typeof data.max === 'number') requestsTotal = data.max;
    }

    // 2. Reset Date
    if (data.billingCycleEnd) resetsAt = data.billingCycleEnd;
    else if (data.resetDate) resetsAt = data.resetDate;
    else if (data.resetsAt) resetsAt = data.resetsAt;
    else if (data.reset_at) resetsAt = data.reset_at;
  }

  return { requestsUsed, requestsTotal, resetsAt };
}

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor_pro',
  async syncCurrentMonth(): Promise<ProviderUsage> {
    const { end, startDate, endDate } = getCurrentMonthWindow();

    const apiUrl = process.env.CURSOR_API_URL;
    const cookie = process.env.CURSOR_COOKIE;

    let requestsUsed = 0;
    let requestsTotal = 100000;
    let resetsAt = end.toISOString();
    let status: ProviderUsage['status'] = 'partial';
    let syncMessage =
      'Offline Mode: Using local cache. Configure CURSOR_COOKIE for real-time sync.';

    // Try reading cached file first to have fallbacks
    try {
      const raw = await readFile(cursorUsagePath, 'utf8');
      const parsed = JSON.parse(raw) as CursorUsageData;
      requestsUsed = parsed.requestsUsed ?? 0;
      requestsTotal = parsed.requestsTotal ?? 500;
      resetsAt = parsed.resetsAt ?? end.toISOString();
      if (new Date(resetsAt) <= new Date()) {
        resetsAt = end.toISOString();
      }
    } catch {
      // Default initial write if file missing
      await mkdir(path.dirname(cursorUsagePath), { recursive: true });
      await writeFile(
        cursorUsagePath,
        JSON.stringify({ requestsUsed, requestsTotal, resetsAt }, null, 2) + '\n',
        'utf8',
      );
    }

    // If API credentials are configured, try fetching live!
    if (apiUrl && cookie) {
      try {
        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'application/json',
            Cookie: cookie,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Write raw response for debugging
        const rawDebugPath = path.join(process.cwd(), 'data', 'cursor-raw-response.json');
        await writeFile(rawDebugPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

        // Extract metrics
        const metrics = extractCursorSummaryMetrics(data);
        requestsUsed = metrics.requestsUsed;
        requestsTotal = metrics.requestsTotal;
        resetsAt = metrics.resetsAt;

        // Cache new metrics
        await writeFile(
          cursorUsagePath,
          JSON.stringify({ requestsUsed, requestsTotal, resetsAt }, null, 2) + '\n',
          'utf8',
        );

        status = 'connected';
        syncMessage = 'Connected and syncing live requests usage via Cursor API.';
      } catch {
        status = 'error';
        syncMessage = 'Session cookie has expired. Fallen back to static JSON file.';
      }
    }

    const percentUsed = Math.min(100, Math.round((requestsUsed / requestsTotal) * 1000) / 10);
    const formattedReset = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(resetsAt));

    const spendUsd = Math.round((requestsUsed / 100) * 100) / 100;
    const budgetUsd = Math.round((requestsTotal / 100) * 100) / 100;
    const remainingUsd = Math.round((budgetUsd - spendUsd) * 100) / 100;

    const spendToday = await calculateDailySpend('cursor-snapshots.json', spendUsd);

    return {
      provider: 'cursor_pro',
      displayName: 'Cursor',
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      budgetUsd,
      spendUsd,
      remainingUsd,
      percentUsed,
      spendToday,
      projectedMonthEndSpendUsd: null,
      dailySpend: [],
      source: status === 'connected' ? 'api' : 'derived',
      status,
      lastSyncedAt: new Date().toISOString(),
      message: syncMessage,
      metadata: {
        requestsUsed,
        requestsTotal,
        resetsAt: formattedReset,
      },
    };
  },
};
