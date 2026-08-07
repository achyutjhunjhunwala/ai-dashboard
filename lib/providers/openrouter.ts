import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow, projectMonthEndSpend } from '../dates';
import { calculateBudgetFields, parseMoney, roundMoney } from '../money';
import type { DailySpend, ModelBreakdown, ProviderUsage } from '../types';
import { fetchJson } from './http';
import type { ProviderAdapter } from './types';

/*
type OpenRouterCreditsResponse = {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
};
*/

type OpenRouterKeyResponse = {
  data?: {
    usage?: number;
    byok_usage?: number;
    limit?: number | null;
    limit_remaining?: number | null;
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

/*
type OpenRouterCredits = {
  totalCredits: number;
  lifetimeUsage: number;
  creditBalance: number | null;
};
*/

type OpenRouterKeySpend = {
  keyCreditsSpend: number;
  keyByokSpend: number;
  keyLifetimeSpend: number;
  keyLimit: number | null;
  keyLimitRemaining: number | null;
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
      let budgetOverride = parseMoney(process.env[`OPENROUTER_MONTHLY_BUDGET_USD${envSuffix}`]);

      // Default limits if unset in .env
      if (budgetOverride === null) {
        if (isBase)
          budgetOverride = 1000; // Default main OpenRouter to 1000 USD
        else if (keySuffix === '1')
          budgetOverride = 500; // Default OpenRouter - 1 limit to 500
        else if (keySuffix === '2') budgetOverride = 500; // Default OpenRouter - 2 limit to 500
      }

      const authKey = apiKey ?? managementApiKey;
      const { startDate, endDate } = getCurrentMonthWindow();

      if (!authKey) {
        return createOpenRouterUsage(providerId, displayName, {
          budgetUsd: budgetOverride,
          spendUsd: null,
          dailySpend: [],
          modelBreakdown: [],
          status: 'not_configured',
          message: `Set OPENROUTER_API_KEY${envSuffix} to connect OpenRouter.`,
        });
      }

      const keySnapshotFile = getKeySnapshotPath(keySuffix);

      try {
        const keySpend = apiKey ? await fetchKeySpend(apiKey) : null;
        // const credits = await fetchCredits(authKey).catch(() => null);
        const snapshotSummary = keySpend
          ? await saveAndSummarizeKeySpendSnapshot(
              keySnapshotFile,
              keySpend.keyLifetimeSpend,
              startDate,
              endDate,
            )
          : { spendUsd: null, dailySpend: [] };
        const activity = managementApiKey
          ? await fetchActivity(managementApiKey, startDate, endDate)
          : ({
              ok: false,
              error: new Error(
                `Set OPENROUTER_MANAGEMENT_API_KEY${envSuffix} to fetch monthly activity. A normal OpenRouter API key can only show credit totals.`,
              ),
            } satisfies ActivityFetchResult);
        const budgetUsd = budgetOverride;
        const spendUsd = activity.ok
          ? activity.summary.spendUsd
          : (keySpend?.keyLifetimeSpend ?? null);
        const dailySpend = activity.ok ? activity.summary.dailySpend : snapshotSummary.dailySpend;

        return createOpenRouterUsage(providerId, displayName, {
          budgetUsd,
          spendUsd,
          dailySpend,
          modelBreakdown: activity.ok ? activity.summary.modelBreakdown : [],
          status: activity.ok ? 'connected' : 'partial',
          message: undefined,
          promptTokens: activity.ok ? activity.summary.promptTokens : undefined,
          completionTokens: activity.ok ? activity.summary.completionTokens : undefined,
          totalTokens: activity.ok ? activity.summary.totalTokens : undefined,
          requestCount: activity.ok ? activity.summary.requestCount : undefined,
          metadata: {
            keyLifetimeSpend: keySpend?.keyLifetimeSpend ?? null,
            // totalCredits: credits?.totalCredits ?? null,
            // lifetimeUsage: credits?.lifetimeUsage ?? null,
          },
        });
      } catch (error) {
        return createOpenRouterUsage(providerId, displayName, {
          budgetUsd: budgetOverride,
          spendUsd: null,
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

  const keyCreditsSpend = roundMoney(keyInfo.data?.usage ?? 0);
  const keyByokSpend = roundMoney(keyInfo.data?.byok_usage ?? 0);

  return {
    keyCreditsSpend,
    keyByokSpend,
    keyLifetimeSpend: roundMoney(keyCreditsSpend + keyByokSpend),
    keyLimit: keyInfo.data?.limit ?? null,
    keyLimitRemaining: keyInfo.data?.limit_remaining ?? null,
  };
}

/*
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
*/

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
  const snapshot = {
    capturedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    keyLifetimeSpend,
  };
  const snapshots = await saveKeySpendSnapshot(keySnapshotFile, snapshot);
  const monthSnapshots = snapshots.filter((item) => item.date >= startDate && item.date < endDate);

  if (monthSnapshots.length < 2) {
    return {
      spendUsd: 0,
      dailySpend: [],
    };
  }

  const first = monthSnapshots[0];
  const latest = monthSnapshots[monthSnapshots.length - 1];

  return {
    spendUsd: roundMoney(Math.max(latest.keyLifetimeSpend - first.keyLifetimeSpend, 0)),
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
