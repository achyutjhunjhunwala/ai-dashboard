import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow } from '../dates';
import type { ProviderUsage } from '../types';
import { calculateDailySpend } from './daily';
import type { ProviderAdapter } from './types';

const chatgptUsagePath = path.join(process.cwd(), 'data', 'chatgpt-usage.json');

type ChatGPTUsageData = {
  creditsUsed: number;
  creditsTotal: number;
  resetsAt: string;
};

interface ChatGPTMetricInput {
  limit?: number | null;
  credits_total?: number | null;
  max_usage?: number | null;
  monthly_usage_limit?: number | null;
  limit_mode_value?: string | number | null;
  usage?: number | null;
  credits_used?: number | null;
  current_usage?: number | null;
  monthly_usage_value?: number | null;
  reset_at?: string | null;
  resets_at?: string | null;
  period_end?: string | null;
  reset_date?: string | null;
}

function extractChatGPTMetrics(data: ChatGPTMetricInput | null | undefined): {
  creditsUsed: number;
  creditsTotal: number;
  resetsAt: string;
} {
  let creditsTotal = 5000;
  let creditsUsed = 0;
  let resetsAt = '2026-09-02T08:02:00.000Z';

  if (data) {
    // 1. Total Limit (Check common paths)
    if (typeof data.limit === 'number') creditsTotal = data.limit;
    else if (typeof data.credits_total === 'number') creditsTotal = data.credits_total;
    else if (typeof data.max_usage === 'number') creditsTotal = data.max_usage;
    else if (typeof data.monthly_usage_limit === 'number') creditsTotal = data.monthly_usage_limit;
    else if (data.limit_mode_value !== undefined) creditsTotal = Number(data.limit_mode_value);

    // 2. Used credits
    if (typeof data.usage === 'number') creditsUsed = data.usage;
    else if (typeof data.credits_used === 'number') creditsUsed = data.credits_used;
    else if (typeof data.current_usage === 'number') creditsUsed = data.current_usage;
    else if (typeof data.monthly_usage_value === 'number') creditsUsed = data.monthly_usage_value;

    // 3. Reset Date
    if (data.reset_at) resetsAt = data.reset_at;
    else if (data.resets_at) resetsAt = data.resets_at;
    else if (data.period_end) resetsAt = data.period_end;
    else if (data.reset_date) resetsAt = data.reset_date;
  }

  return { creditsUsed, creditsTotal, resetsAt };
}

export const chatgptAdapter: ProviderAdapter = {
  id: 'chatgpt_enterprise',
  async syncCurrentMonth(): Promise<ProviderUsage> {
    const { startDate, endDate } = getCurrentMonthWindow();

    const apiUrl = process.env.CHATGPT_ENTERPRISE_API_URL;
    const cookie = process.env.CHATGPT_ENTERPRISE_COOKIE;
    const auth = process.env.CHATGPT_ENTERPRISE_AUTHORIZATION;

    let creditsUsed = 0;
    let creditsTotal = 5000;
    let resetsAt = '2026-09-02T08:02:00.000Z';
    let status: ProviderUsage['status'] = 'partial';
    let syncMessage =
      'Offline Mode: Using local cache. Configure CHATGPT_ENTERPRISE_COOKIE for real-time sync.';

    // Try reading cached file first to have fallbacks
    try {
      const raw = await readFile(chatgptUsagePath, 'utf8');
      const parsed = JSON.parse(raw) as ChatGPTUsageData;
      creditsUsed = parsed.creditsUsed ?? 0;
      creditsTotal = parsed.creditsTotal ?? 5000;
      resetsAt = parsed.resetsAt ?? '2026-09-02T08:02:00.000Z';
    } catch {
      // Default initial write if file missing
      await mkdir(path.dirname(chatgptUsagePath), { recursive: true });
      await writeFile(
        chatgptUsagePath,
        JSON.stringify({ creditsUsed, creditsTotal, resetsAt }, null, 2) + '\n',
        'utf8',
      );
    }

    // If API credentials are configured, try fetching live!
    if (apiUrl && cookie && auth) {
      try {
        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'application/json',
            Cookie: cookie,
            Authorization: auth,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Write raw response for debugging
        const rawDebugPath = path.join(process.cwd(), 'data', 'chatgpt-raw-response.json');
        await writeFile(rawDebugPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

        // Extract metrics
        const metrics = extractChatGPTMetrics(data);
        creditsUsed = metrics.creditsUsed;
        creditsTotal = metrics.creditsTotal;
        resetsAt = metrics.resetsAt;

        // Cache new metrics
        await writeFile(
          chatgptUsagePath,
          JSON.stringify({ creditsUsed, creditsTotal, resetsAt }, null, 2) + '\n',
          'utf8',
        );

        status = 'connected';
        syncMessage = 'Connected and syncing live credits usage via OpenAI backend API.';
      } catch {
        status = 'error';
        syncMessage =
          'Session cookie or authorization token has expired. Fallen back to static JSON file.';
      }
    }

    const percentUsed = Math.min(100, Math.round((creditsUsed / creditsTotal) * 1000) / 10);
    const formattedReset = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(resetsAt));

    const spendToday = await calculateDailySpend('chatgpt-snapshots.json', creditsUsed);

    return {
      provider: 'chatgpt_enterprise',
      displayName: 'Open AI - Codex',
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      budgetUsd: null,
      spendUsd: null,
      remainingUsd: null,
      percentUsed,
      spendToday,
      projectedMonthEndSpendUsd: null,
      dailySpend: [],
      source: status === 'connected' ? 'api' : 'derived',
      status,
      lastSyncedAt: new Date().toISOString(),
      message: syncMessage,
      metadata: {
        creditsUsed,
        creditsTotal,
        resetsAt: formattedReset,
      },
    };
  },
};
