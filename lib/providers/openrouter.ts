import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow, projectMonthEndSpend } from '../dates';
import { calculateBudgetFields, parseMoney, roundMoney } from '../money';
import type { DailySpend, ModelBreakdown, ProviderUsage } from '../types';
import { fetchJson } from './http';
import type { ProviderAdapter } from './types';

type OpenRouterCreditsResponse = {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
};

type OpenRouterKeyResponse = {
  data?: {
    label?: string;
    is_management_key?: boolean;
    is_provisioning_key?: boolean;
    limit?: number | null;
    limit_remaining?: number | null;
    limit_reset?: string | null;
    include_byok_in_limit?: boolean;
    usage?: number;
    usage_daily?: number;
    usage_weekly?: number;
    usage_monthly?: number;
    byok_usage?: number;
    byok_usage_daily?: number;
    byok_usage_weekly?: number;
    byok_usage_monthly?: number;
    is_free_tier?: boolean;
    expires_at?: string | null;
  };
};

type OpenRouterActivityResponse = {
  data?: OpenRouterActivityItem[];
};

type OpenRouterActivityItem = {
  date: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  requests: number;
  usage: number;
};

type OpenRouterCredits = {
  totalCredits: number;
  lifetimeUsage: number;
  creditBalance: number | null;
};

type OpenRouterKeySpend = {
  keyCreditsSpend: number;
  keyByokSpend: number;
  keyLifetimeSpend: number;
  keyMonthlySpend: number | null;
  keyDailySpend: number | null;
  keyLimit: number | null;
  keyLimitRemaining: number | null;
  keyLimitReset: string | null;
};

type OpenRouterActivitySummary = {
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  dailySpend: DailySpend[];
  modelBreakdown: ModelBreakdown[];
};

type ActivityFetchResult =
  | {
      ok: true;
      summary: OpenRouterActivitySummary;
    }
  | {
      ok: false;
      error: unknown;
    };

type DailyAccumulator = {
  date: string;
  spendUsd: number;
};

type KeySpendSnapshot = {
  capturedAt: string;
  date: string;
  keyLifetimeSpend: number;
};

const keySnapshotPath = path.join(process.cwd(), 'data', 'openrouter-key-snapshots.json');

function getKeySnapshotPath(keySuffix: string) {
  if (keySuffix === '1') {
    return keySnapshotPath;
  }
  return path.join(process.cwd(), 'data', `openrouter-key-snapshots-${keySuffix}.json`);
}

function createOpenRouterAdapter(
  keySuffix: string,
  envSuffix: string,
  displayName: string,
): ProviderAdapter {
  const isBase = keySuffix === '3';
  const providerId = isBase ? 'openrouter' : `openrouter_${keySuffix}`;

  return {
    id: providerId,
    async syncCurrentMonth() {
      const apiKey = process.env[`OPENROUTER_API_KEY${envSuffix}`];
      const managementApiKey = process.env[`OPENROUTER_MANAGEMENT_API_KEY${envSuffix}`];
      const budgetOverride = parseMoney(process.env[`OPENROUTER_MONTHLY_BUDGET_USD${envSuffix}`]);

      const authKey = apiKey ?? managementApiKey;
      const { startDate, endDate } = getCurrentMonthWindow();

      if (!authKey) {
        return createOpenRouterUsage(providerId, displayName, {
          budgetUsd: budgetOverride ?? (isBase ? 1000 : 500),
          spendUsd: null,
          spendToday: null,
          dailySpend: [],
          modelBreakdown: [],
          status: 'not_configured',
          message: `Set OPENROUTER_API_KEY${envSuffix} to connect OpenRouter.`,
        });
      }

      const keySnapshotFile = getKeySnapshotPath(keySuffix);

      try {
        const keySpend = apiKey ? await fetchKeySpend(apiKey) : null;
        const credits = await fetchCredits(authKey).catch(() => null);

        let budgetUsd = budgetOverride;
        if (budgetUsd === null) {
          if (typeof keySpend?.keyLimit === 'number' && keySpend.keyLimit > 0) {
            budgetUsd = keySpend.keyLimit;
          } else if (isBase) {
            budgetUsd = 1000;
          } else {
            budgetUsd = 500;
          }
        }

        const snapshotSummary = keySpend
          ? await saveAndSummarizeKeySpendSnapshot(
              keySnapshotFile,
              keySpend.keyLifetimeSpend,
              startDate,
              endDate,
            )
          : { spendUsd: null, spendToday: null, dailySpend: [] };

        const activity = managementApiKey
          ? await fetchActivity(managementApiKey, startDate, endDate)
          : ({
              ok: false,
              error: new Error(
                `Set OPENROUTER_MANAGEMENT_API_KEY${envSuffix} to fetch monthly activity. A normal OpenRouter API key can only show credit totals.`,
              ),
            } satisfies ActivityFetchResult);

        let spendUsd: number | null = null;
        if (activity.ok) {
          spendUsd = activity.summary.spendUsd;
        } else if (keySpend?.keyMonthlySpend !== null && keySpend?.keyMonthlySpend !== undefined) {
          spendUsd = keySpend.keyMonthlySpend;
        } else if (snapshotSummary.spendUsd !== null) {
          spendUsd = snapshotSummary.spendUsd;
        } else if (keySpend) {
          spendUsd = keySpend.keyLifetimeSpend;
        }

        const spendToday =
          keySpend?.keyDailySpend !== null && keySpend?.keyDailySpend !== undefined
            ? keySpend.keyDailySpend
            : snapshotSummary.spendToday;

        const dailySpend = activity.ok ? activity.summary.dailySpend : snapshotSummary.dailySpend;

        const isConnected = activity.ok || keySpend !== null;

        return createOpenRouterUsage(providerId, displayName, {
          budgetUsd,
          spendUsd,
          spendToday,
          dailySpend,
          modelBreakdown: activity.ok ? activity.summary.modelBreakdown : [],
          status: isConnected ? 'connected' : 'partial',
          message: undefined,
          promptTokens: activity.ok ? activity.summary.promptTokens : undefined,
          completionTokens: activity.ok ? activity.summary.completionTokens : undefined,
          totalTokens: activity.ok ? activity.summary.totalTokens : undefined,
          requestCount: activity.ok ? activity.summary.requestCount : undefined,
          metadata: {
            keyLifetimeSpend: keySpend?.keyLifetimeSpend ?? null,
            keyMonthlySpend: keySpend?.keyMonthlySpend ?? null,
            keyLimitRemaining: keySpend?.keyLimitRemaining ?? null,
            totalCredits: credits?.totalCredits ?? null,
            lifetimeUsage: credits?.lifetimeUsage ?? null,
            creditBalance: credits?.creditBalance ?? null,
          },
        });
      } catch (error) {
        return createOpenRouterUsage(providerId, displayName, {
          budgetUsd: budgetOverride ?? (isBase ? 1000 : 500),
          spendUsd: null,
          spendToday: null,
          dailySpend: [],
          modelBreakdown: [],
          status: 'error',
          message: `OpenRouter sync failed. ${formatError(error)}`,
        });
      }
    },
  };
}

function isKeyConfigured(keySuffix: string, envSuffix: string): boolean {
  const apiKey = process.env[`OPENROUTER_API_KEY${envSuffix}`];
  const mgmtKey = process.env[`OPENROUTER_MANAGEMENT_API_KEY${envSuffix}`];

  if (apiKey && apiKey.trim()) return true;
  if (mgmtKey && mgmtKey.trim()) return true;

  return false;
}

export function getOpenRouterAdapters(): ProviderAdapter[] {
  const suffixes = new Set<string>();

  // Base card (without suffix) is always included!
  suffixes.add('3');

  // Scan environment variables for Key 1 (_1) and Key 2 (_2)
  if (isKeyConfigured('1', '_1')) {
    suffixes.add('1');
  }
  if (isKeyConfigured('2', '_2')) {
    suffixes.add('2');
  }

  // Sort suffixes numerically
  const sortedSuffixes = Array.from(suffixes).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  return sortedSuffixes.map((suffix) => {
    if (suffix === '3') {
      return createOpenRouterAdapter('3', '', 'OpenRouter');
    }
    if (suffix === '1') {
      return createOpenRouterAdapter('1', '_1', 'OpenRouter - 1');
    }
    return createOpenRouterAdapter('2', '_2', 'OpenRouter - 2');
  });
}

// Statically evaluated list for legacy exports
export const openrouterAdapters: ProviderAdapter[] = getOpenRouterAdapters();

export const openrouterAdapter: ProviderAdapter =
  openrouterAdapters[0] || createOpenRouterAdapter('3', '', 'OpenRouter');

async function fetchKeySpend(apiKey: string): Promise<OpenRouterKeySpend> {
  const keyInfo = await fetchJson<OpenRouterKeyResponse>('https://openrouter.ai/api/v1/key', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = keyInfo.data;
  const keyCreditsSpend = roundMoney(data?.usage ?? 0);
  const keyByokSpend = roundMoney(data?.byok_usage ?? 0);
  const keyLifetimeSpend = roundMoney(keyCreditsSpend + keyByokSpend);

  const hasMonthlyUsage = typeof data?.usage_monthly === 'number';
  const keyMonthlySpend = hasMonthlyUsage
    ? roundMoney((data.usage_monthly ?? 0) + (data?.byok_usage_monthly ?? 0))
    : null;

  const hasDailyUsage = typeof data?.usage_daily === 'number';
  const keyDailySpend = hasDailyUsage
    ? roundMoney((data.usage_daily ?? 0) + (data?.byok_usage_daily ?? 0))
    : null;

  return {
    keyCreditsSpend,
    keyByokSpend,
    keyLifetimeSpend,
    keyMonthlySpend,
    keyDailySpend,
    keyLimit: typeof data?.limit === 'number' ? data.limit : null,
    keyLimitRemaining: typeof data?.limit_remaining === 'number' ? data.limit_remaining : null,
    keyLimitReset: data?.limit_reset ?? null,
  };
}

async function fetchCredits(apiKey: string): Promise<OpenRouterCredits> {
  const credits = await fetchJson<OpenRouterCreditsResponse>(
    'https://openrouter.ai/api/v1/credits',
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  const totalCredits = credits.data?.total_credits ?? null;
  const lifetimeUsage = credits.data?.total_usage ?? null;

  if (totalCredits === null || lifetimeUsage === null) {
    throw new Error('OpenRouter credits response did not include total_credits and total_usage.');
  }

  const creditBalance = roundMoney(totalCredits - lifetimeUsage);

  return {
    totalCredits: roundMoney(totalCredits),
    lifetimeUsage: roundMoney(lifetimeUsage),
    creditBalance: creditBalance >= 0 ? creditBalance : null,
  };
}

async function fetchActivity(
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<ActivityFetchResult> {
  try {
    const activity = await fetchJson<OpenRouterActivityResponse>(
      'https://openrouter.ai/api/v1/activity',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const monthItems =
      activity.data?.filter((item) => item.date >= startDate && item.date < endDate) ?? [];

    return {
      ok: true,
      summary: summarizeActivity(monthItems),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function summarizeActivity(items: OpenRouterActivityItem[]): OpenRouterActivitySummary {
  const dailySpend = new Map<string, DailyAccumulator>();
  const models = new Map<string, ModelBreakdown>();

  let spendUsd = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let requestCount = 0;

  for (const item of items) {
    spendUsd += item.usage;
    promptTokens += item.prompt_tokens;
    completionTokens += item.completion_tokens;
    reasoningTokens += item.reasoning_tokens;
    requestCount += item.requests;

    const daily = dailySpend.get(item.date) ?? { date: item.date, spendUsd: 0 };
    daily.spendUsd += item.usage;
    dailySpend.set(item.date, daily);

    const model = models.get(item.model) ?? {
      model: item.model,
      spendUsd: 0,
      totalTokens: 0,
    };
    model.spendUsd += item.usage;
    model.totalTokens =
      (model.totalTokens ?? 0) +
      item.prompt_tokens +
      item.completion_tokens +
      item.reasoning_tokens;
    models.set(item.model, model);
  }

  return {
    spendUsd: roundMoney(spendUsd),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens + reasoningTokens,
    requestCount,
    dailySpend: Array.from(dailySpend.values())
      .map((day) => ({
        ...day,
        spendUsd: roundMoney(day.spendUsd),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    modelBreakdown: Array.from(models.values())
      .map((model) => ({
        ...model,
        spendUsd: roundMoney(model.spendUsd),
      }))
      .sort((a, b) => b.spendUsd - a.spendUsd)
      .slice(0, 8),
  };
}

async function saveAndSummarizeKeySpendSnapshot(
  keySnapshotFile: string,
  keyLifetimeSpend: number,
  startDate: string,
  endDate: string,
) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    date: todayStr,
    keyLifetimeSpend,
  };
  const snapshots = await saveKeySpendSnapshot(keySnapshotFile, snapshot);
  const monthSnapshots = snapshots.filter((item) => item.date >= startDate && item.date < endDate);

  const todaySnapshots = monthSnapshots.filter((item) => item.date === todayStr);
  let spendToday = 0;
  if (todaySnapshots.length > 0) {
    const latestToday = todaySnapshots[todaySnapshots.length - 1];
    const priorSnapshots = snapshots.filter((item) => item.date < todayStr);
    if (priorSnapshots.length > 0) {
      const lastPrior = priorSnapshots[priorSnapshots.length - 1];
      spendToday = Math.max(
        0,
        roundMoney(latestToday.keyLifetimeSpend - lastPrior.keyLifetimeSpend),
      );
    }
  }

  if (monthSnapshots.length < 2) {
    return {
      spendUsd: 0,
      spendToday,
      dailySpend: [],
    };
  }

  const first = monthSnapshots[0];
  const latest = monthSnapshots[monthSnapshots.length - 1];

  return {
    spendUsd: roundMoney(Math.max(latest.keyLifetimeSpend - first.keyLifetimeSpend, 0)),
    spendToday,
    dailySpend: monthSnapshots.slice(1).map((item, index) => ({
      date: item.date,
      spendUsd: roundMoney(
        Math.max(item.keyLifetimeSpend - monthSnapshots[index].keyLifetimeSpend, 0),
      ),
    })),
  };
}

async function saveKeySpendSnapshot(keySnapshotFile: string, snapshot: KeySpendSnapshot) {
  const existing = await readKeySpendSnapshots(keySnapshotFile);
  const withoutToday = existing.filter((item) => item.date !== snapshot.date);
  const snapshots = [...withoutToday, snapshot].sort((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt),
  );

  await mkdir(path.dirname(keySnapshotFile), { recursive: true });
  await writeFile(keySnapshotFile, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');

  return snapshots;
}

async function readKeySpendSnapshots(keySnapshotFile: string): Promise<KeySpendSnapshot[]> {
  try {
    const raw = await readFile(keySnapshotFile, 'utf8');
    const parsed = JSON.parse(raw) as KeySpendSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function createOpenRouterUsage(
  provider: string,
  displayName: string,
  input: {
    budgetUsd: number | null;
    spendUsd: number | null;
    spendToday: number | null;
    dailySpend: DailySpend[];
    modelBreakdown: ModelBreakdown[];
    status: ProviderUsage['status'];
    message?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    requestCount?: number;
    metadata?: ProviderUsage['metadata'];
  },
): ProviderUsage {
  const { startDate, endDate } = getCurrentMonthWindow();
  const budget = calculateBudgetFields(input.spendUsd, input.budgetUsd);

  return {
    provider,
    displayName,
    billingPeriodStart: startDate,
    billingPeriodEnd: endDate,
    budgetUsd: input.budgetUsd,
    spendUsd: input.spendUsd,
    spendToday: input.spendToday,
    remainingUsd: budget.remainingUsd,
    percentUsed: budget.percentUsed,
    projectedMonthEndSpendUsd: projectMonthEndSpend(input.spendUsd),
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens,
    requestCount: input.requestCount,
    dailySpend: input.dailySpend,
    modelBreakdown: input.modelBreakdown,
    source: input.status === 'partial' ? 'derived' : 'api',
    status: input.status,
    lastSyncedAt: new Date().toISOString(),
    message: input.message,
    metadata: input.metadata,
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}
