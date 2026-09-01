import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow } from '../dates';
import { calculateBudgetFields, roundMoney } from '../money';
import type { ProviderUsage } from '../types';
import { calculateDailySpend } from './daily';
import type { ProviderAdapter } from './types';

const copilotUsagePath = path.join(process.cwd(), 'data', 'copilot-usage.json');

type CopilotUsageData = {
  creditsUsed: number;
  creditsTotal: number;
  resetDate: string;
};

type CopilotApiResponse = {
  licenseType?: string;
  quotas?: {
    limits?: {
      premiumInteractions?: number;
    };
    resetDate?: string;
    resetDateUtc?: string;
    premiumInteractionsQuota?: {
      total?: number;
      used?: number;
      creditsUsed?: number;
    };
  };
};

function formatResetDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
  } catch {}
  return dateStr;
}

export const copilotAdapter: ProviderAdapter = {
  id: 'github_copilot',
  async syncCurrentMonth(): Promise<ProviderUsage> {
    const { end, startDate, endDate } = getCurrentMonthWindow();

    const cookie = process.env.GITHUB_COPILOT_COOKIE;
    const authorization = process.env.GITHUB_COPILOT_AUTHORIZATION;
    const isActive = process.env.GITHUB_COPILOT_ACTIVE === 'true';

    let creditsUsed = 0;
    let creditsTotal = 100000;
    let resetDate = formatResetDate(end.toISOString());
    let status: ProviderUsage['status'] = 'partial';
    let syncMessage =
      'Offline Mode: Using local cache. Configure GITHUB_COPILOT_COOKIE or GITHUB_COPILOT_AUTHORIZATION for real-time sync.';

    // Try reading cached file first to have fallbacks
    try {
      const raw = await readFile(copilotUsagePath, 'utf8');
      const parsed = JSON.parse(raw) as CopilotUsageData;
      creditsUsed = parsed.creditsUsed ?? 0;
      creditsTotal = parsed.creditsTotal ?? 100000;
      resetDate = parsed.resetDate ?? formatResetDate(end.toISOString());
      if (new Date(resetDate) <= new Date()) {
        resetDate = formatResetDate(end.toISOString());
      }
    } catch {
      // Default initial write if file missing
      await mkdir(path.dirname(copilotUsagePath), { recursive: true });
      await writeFile(
        copilotUsagePath,
        JSON.stringify({ creditsUsed, creditsTotal, resetDate }, null, 2) + '\n',
        'utf8',
      );
    }

    if (isActive && (cookie || authorization)) {
      try {
        const headers: Record<string, string> = {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        };

        if (cookie) {
          headers['Cookie'] = cookie;
        }

        if (authorization) {
          headers['Authorization'] =
            authorization.startsWith('Bearer ') || authorization.startsWith('token ')
              ? authorization
              : `Bearer ${authorization}`;
        }

        const response = await fetch('https://github.com/github-copilot/chat/entitlement', {
          headers,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as CopilotApiResponse;

        // Write raw response for debugging
        const rawDebugPath = path.join(process.cwd(), 'data', 'copilot-raw-response.json');
        await writeFile(rawDebugPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

        // Extract metrics
        if (data && data.quotas) {
          const quota = data.quotas.premiumInteractionsQuota;
          if (quota) {
            creditsUsed = quota.creditsUsed ?? quota.used ?? 0;
            creditsTotal = quota.total ?? 100000;
          } else if (data.quotas.limits?.premiumInteractions) {
            creditsTotal = data.quotas.limits.premiumInteractions;
          }

          const apiResetDate = data.quotas.resetDateUtc || data.quotas.resetDate;
          if (apiResetDate) {
            resetDate = formatResetDate(apiResetDate);
          }
        }

        // Cache new metrics
        await writeFile(
          copilotUsagePath,
          JSON.stringify({ creditsUsed, creditsTotal, resetDate }, null, 2) + '\n',
          'utf8',
        );

        status = 'connected';
        syncMessage = 'Connected and syncing live credits via GitHub Copilot entitlement API.';
      } catch {
        status = 'error';
        syncMessage =
          'Session cookie or Bearer token has expired. Fallen back to static JSON file.';
      }
    } else {
      status = 'partial';
      syncMessage =
        'Offline Mode: Using local cache. Configure GITHUB_COPILOT_COOKIE or GITHUB_COPILOT_AUTHORIZATION for real-time sync.';
    }

    // Convert credits to USD spend: 1 AI Credit = $0.01 USD
    const spendUsd = roundMoney(creditsUsed * 0.01);
    const budgetUsd = roundMoney(creditsTotal * 0.01);
    const budget = calculateBudgetFields(spendUsd, budgetUsd);
    const spendToday = await calculateDailySpend('copilot-snapshots.json', spendUsd, startDate);

    return {
      provider: 'github_copilot',
      displayName: 'GitHub Copilot',
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      budgetUsd,
      spendUsd,
      remainingUsd: budget.remainingUsd,
      percentUsed: budget.percentUsed,
      spendToday,
      projectedMonthEndSpendUsd: null,
      source: isActive && (cookie || authorization) ? 'api' : 'derived',
      status,
      lastSyncedAt: new Date().toISOString(),
      message: syncMessage,
      metadata: {
        creditsUsed,
        creditsTotal,
        resetDate,
      },
      dailySpend: [],
    };
  },
};
