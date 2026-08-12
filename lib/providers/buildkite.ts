import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow } from '../dates';
import { calculateBudgetFields, parseMoney, roundMoney } from '../money';
import type { ProviderUsage } from '../types';
import { calculateDailySpend } from './daily';
import type { ProviderAdapter } from './types';

const buildkiteUsagePath = path.join(process.cwd(), 'data', 'buildkite-usage.json');

type BuildkiteUsageData = {
  spendUsd: number;
};

export const buildkiteAdapter: ProviderAdapter = {
  id: 'buildkite',
  async syncCurrentMonth(): Promise<ProviderUsage> {
    const { startDate, endDate } = getCurrentMonthWindow();

    const esUrl = process.env.BUILDKITE_ES_URL;
    const esApiKey = process.env.BUILDKITE_ES_API_KEY;
    const repoName = process.env.BUILDKITE_REPO_NAME ?? 'achyutjhunjhunwala/kibana';
    const budgetOverride = parseMoney(process.env.BUILDKITE_MONTHLY_BUDGET_USD);

    let spendUsd = 0;
    let status: ProviderUsage['status'] = 'connected';
    let syncMessage = 'Live sync active with Elasticsearch Buildkite stats index.';

    // Try reading cached file first to have fallbacks
    try {
      const raw = await readFile(buildkiteUsagePath, 'utf8');
      const parsed = JSON.parse(raw) as BuildkiteUsageData;
      spendUsd = parsed.spendUsd ?? 0;
    } catch {
      // Default initial write if file missing (seeded to $0.00 spend initially)
      spendUsd = 0;
      await mkdir(path.dirname(buildkiteUsagePath), { recursive: true });
      await writeFile(buildkiteUsagePath, JSON.stringify({ spendUsd }, null, 2) + '\n', 'utf8');
    }

    if (esUrl && esApiKey) {
      try {
        // Construct the exact, live ES|QL query
        const query = `FROM buildkite-builds* | WHERE @timestamp >= "${startDate}T00:00:00.000Z" AND @timestamp < "${endDate}T00:00:00.000Z" | WHERE pipeline.slug.keyword == "kibana-pull-request" | WHERE pull_request.repository.keyword IN ("${repoName}") | STATS total = SUM(agentCostDiscounted)`;

        const searchUrl = `${esUrl}/_query?format=json`;
        const response = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              esApiKey.startsWith('ApiKey') ||
              esApiKey.startsWith('Basic') ||
              esApiKey.startsWith('Bearer')
                ? esApiKey
                : `ApiKey ${esApiKey}`,
          },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Write raw response for debugging and inspection of ES|QL payload
        const rawDebugPath = path.join(process.cwd(), 'data', 'buildkite-raw-response.json');
        await writeFile(rawDebugPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

        // Extract aggregated spend value from ES|QL values table
        let extractedSpend = 0;
        if (data && Array.isArray(data.values) && data.values[0] && Array.isArray(data.values[0])) {
          extractedSpend = data.values[0][0] ?? 0;
        }
        spendUsd = roundMoney(extractedSpend);

        // Cache new metrics
        await writeFile(buildkiteUsagePath, JSON.stringify({ spendUsd }, null, 2) + '\n', 'utf8');

        status = 'connected';
        syncMessage = `Connected and syncing live agent cost for ${repoName} via ES|QL.`;
      } catch {
        status = 'error';
        syncMessage = 'Latest data cannot be fetched as auth expired';
      }
    }

    const budget = calculateBudgetFields(spendUsd, budgetOverride ?? 500); // Default budget override fallback to 500 USD

    const spendToday = await calculateDailySpend('buildkite-snapshots.json', spendUsd);

    return {
      provider: 'buildkite',
      displayName: 'Buildkite CI Cost',
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      budgetUsd: budgetOverride ?? 500, // Default Buildkite budget to 500 USD
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
      metadata: {},
    };
  },
};
