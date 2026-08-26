import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow } from '../dates';
import { calculateBudgetFields, parseMoney, roundMoney } from '../money';
import type { ProviderUsage } from '../types';
import { calculateDailySpend } from './daily';
import type { ProviderAdapter } from './types';

const claudeUsagePath = path.join(process.cwd(), 'data', 'claude-usage.json');

type ClaudeUsageData = {
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requestCount: number;
};

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  async syncCurrentMonth(): Promise<ProviderUsage> {
    const { startDate, endDate } = getCurrentMonthWindow();

    const baseUrl = process.env.CLAUDE_API_URL;
    const cookie = process.env.CLAUDE_COOKIE;
    let budgetOverride = parseMoney(process.env.CLAUDE_MONTHLY_BUDGET_USD);
    if (budgetOverride === null) {
      budgetOverride = 1000; // Default Claude limit to 1000
    }

    let spendUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let requestCount = 0;
    let status: ProviderUsage['status'] = 'partial';
    let syncMessage =
      'Offline Mode: Using local cache. Configure CLAUDE_COOKIE for real-time sync.';

    // Try reading cached file first to have fallbacks
    try {
      const raw = await readFile(claudeUsagePath, 'utf8');
      const parsed = JSON.parse(raw) as ClaudeUsageData;
      spendUsd = parsed.spendUsd ?? 0;
      inputTokens = parsed.inputTokens ?? 0;
      outputTokens = parsed.outputTokens ?? 0;
      cacheReadTokens = parsed.cacheReadTokens ?? 0;
      requestCount = parsed.requestCount ?? 0;
    } catch {
      // Default initial write if file missing
      await mkdir(path.dirname(claudeUsagePath), { recursive: true });
      await writeFile(
        claudeUsagePath,
        JSON.stringify(
          { spendUsd, inputTokens, outputTokens, cacheReadTokens, requestCount },
          null,
          2,
        ) + '\n',
        'utf8',
      );
    }

    if (baseUrl && cookie) {
      try {
        // Construct dynamic start and end date URL matching the current month window
        const urlObj = new URL(baseUrl);
        urlObj.searchParams.set('start_date', startDate);
        urlObj.searchParams.set('end_date', endDate);
        urlObj.searchParams.set('group_by', 'product_surface');
        urlObj.searchParams.set('granularity', 'daily');

        const response = await fetch(urlObj.toString(), {
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
        const rawDebugPath = path.join(process.cwd(), 'data', 'claude-raw-response.json');
        await writeFile(rawDebugPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

        // Support both /usage and /usage/spend endpoints
        if (data && data.spend && data.spend.used) {
          // This is the /usage endpoint response
          const totalMinorUnits = data.spend.used.amount_minor ?? 0;
          const exponent = data.spend.used.exponent ?? 2;
          spendUsd = roundMoney(totalMinorUnits / Math.pow(10, exponent));

          // Auto-detect budget limit from API if not specified in .env
          if (data.spend.limit && process.env.CLAUDE_MONTHLY_BUDGET_USD === undefined) {
            const limitMinor = data.spend.limit.amount_minor ?? 0;
            const limitExponent = data.spend.limit.exponent ?? 2;
            budgetOverride = roundMoney(limitMinor / Math.pow(10, limitExponent));
          }
        } else {
          // This is the /usage/spend endpoint response
          let totalMinorUnits = 0;
          if (data && Array.isArray(data.totals)) {
            for (const item of data.totals) {
              totalMinorUnits += item.cost_minor_units ?? 0;
            }
          }
          spendUsd = roundMoney(totalMinorUnits / 100);

          // Sum token metrics and request count from series
          if (data && Array.isArray(data.series)) {
            inputTokens = 0;
            outputTokens = 0;
            cacheReadTokens = 0;
            requestCount = 0;
            for (const item of data.series) {
              requestCount += item.request_count ?? 0;
              if (item.tokens) {
                inputTokens += item.tokens.input ?? 0;
                outputTokens += item.tokens.output ?? 0;
                cacheReadTokens += item.tokens.cache_read ?? 0;
              }
            }
          }
        }

        // Cache new metrics
        await writeFile(
          claudeUsagePath,
          JSON.stringify(
            { spendUsd, inputTokens, outputTokens, cacheReadTokens, requestCount },
            null,
            2,
          ) + '\n',
          'utf8',
        );

        status = 'connected';
        syncMessage = 'Connected and syncing live billing spend via Claude.ai API.';
      } catch {
        status = 'error';
        syncMessage = 'Session cookie has expired. Fallen back to static JSON file.';
      }
    }

    const budget = calculateBudgetFields(spendUsd, budgetOverride);

    const spendToday = await calculateDailySpend('claude-snapshots.json', spendUsd);

    return {
      provider: 'claude',
      displayName: 'Claude.ai',
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      budgetUsd: budgetOverride,
      spendUsd,
      remainingUsd: budget.remainingUsd,
      percentUsed: budget.percentUsed,
      spendToday,
      projectedMonthEndSpendUsd: null,
      dailySpend: [],
      source: status === 'connected' ? 'api' : 'derived',
      status,
      lastSyncedAt: new Date().toISOString(),
      message: syncMessage,
      metadata: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        requestCount,
      },
    };
  },
};
