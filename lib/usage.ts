import { existsSync } from 'fs';
import path from 'path';

import { getCurrentMonthWindow } from './dates';
import { roundMoney } from './money';
import { chatgptAdapter } from './providers/chatgpt';
import { claudeAdapter } from './providers/claude';
import { cursorAdapter } from './providers/cursor';
import { copilotAdapter } from './providers/copilot';
import { buildkiteAdapter } from './providers/buildkite';
import { getOpenRouterAdapters } from './providers/openrouter';
import type { DashboardData, ProviderUsage } from './types';

export async function getCurrentMonthUsage(): Promise<DashboardData> {
  const adapters = [...getOpenRouterAdapters()];

  const hasChatGPT =
    process.env.CHATGPT_ENTERPRISE_ACTIVE === 'true' ||
    existsSync(path.join(process.cwd(), 'data', 'chatgpt-usage.json'));

  if (hasChatGPT) {
    adapters.push(chatgptAdapter);
  }

  const hasCursor =
    process.env.CURSOR_ACTIVE === 'true' ||
    existsSync(path.join(process.cwd(), 'data', 'cursor-usage.json'));

  if (hasCursor) {
    adapters.push(cursorAdapter);
  }

  const hasCopilot =
    process.env.GITHUB_COPILOT_ACTIVE === 'true' ||
    existsSync(path.join(process.cwd(), 'data', 'copilot-usage.json'));

  if (hasCopilot) {
    adapters.push(copilotAdapter);
  }

  const hasClaude =
    process.env.CLAUDE_ACTIVE === 'true' ||
    existsSync(path.join(process.cwd(), 'data', 'claude-usage.json'));

  if (hasClaude) {
    adapters.push(claudeAdapter);
  }

  const hasBuildkite =
    process.env.BUILDKITE_ACTIVE === 'true' ||
    existsSync(path.join(process.cwd(), 'data', 'buildkite-usage.json'));

  if (hasBuildkite) {
    adapters.push(buildkiteAdapter);
  }

  const providers = await Promise.all(adapters.map((adapter) => adapter.syncCurrentMonth()));
  const { startDate, endDate } = getCurrentMonthWindow();

  // Stable sort providers based on user's priority order:
  // 1. claude
  // 2. cursor_pro
  // 3. openrouter
  // 4. chatgpt_enterprise (Codex)
  // 5. github_copilot
  // 6. everything else (openrouter_1, openrouter_2)
  // 7. buildkite (last)
  const orderedProviders = [...providers].sort((a, b) => {
    const getOrderScore = (providerId: string) => {
      if (providerId === 'claude') return 1;
      if (providerId === 'cursor_pro') return 2;
      if (providerId === 'openrouter') return 3;
      if (providerId === 'chatgpt_enterprise') return 4;
      if (providerId === 'github_copilot') return 5;
      if (providerId === 'buildkite') return 99;
      return 10;
    };

    const scoreA = getOrderScore(a.provider);
    const scoreB = getOrderScore(b.provider);

    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }

    return providers.indexOf(a) - providers.indexOf(b);
  });

  // Exclude Buildkite, GitHub Copilot, and Codex from overall USD budget and spend summaries
  const usdProviders = providers.filter(
    (p) =>
      p.provider !== 'buildkite' &&
      p.provider !== 'github_copilot' &&
      p.provider !== 'chatgpt_enterprise',
  );

  const totalBudgetUsd = sumNullable(usdProviders.map((provider) => provider.budgetUsd));
  const totalSpendUsd = sumNullable(usdProviders.map((provider) => provider.spendUsd));
  const totalRemainingUsd =
    totalBudgetUsd === null || totalSpendUsd === null
      ? null
      : roundMoney(totalBudgetUsd - totalSpendUsd);
  const percentUsed =
    totalBudgetUsd && totalSpendUsd !== null
      ? Math.min(100, Math.round((totalSpendUsd / totalBudgetUsd) * 1000) / 10)
      : null;

  return {
    summary: {
      billingPeriodStart: startDate,
      billingPeriodEnd: endDate,
      totalBudgetUsd,
      totalSpendUsd,
      totalRemainingUsd,
      percentUsed,
      projectedMonthEndSpendUsd: sumNullable(
        usdProviders.map((provider) => provider.projectedMonthEndSpendUsd),
      ),
      lastSyncedAt: getLatestSync(orderedProviders),
    },
    providers: orderedProviders,
  };
}

function sumNullable(values: Array<number | null>) {
  const knownValues = values.filter((value): value is number => value !== null);
  if (knownValues.length === 0) {
    return null;
  }

  return roundMoney(knownValues.reduce((total, value) => total + value, 0));
}

function getLatestSync(providers: ProviderUsage[]) {
  const timestamps = providers
    .map((provider) => provider.lastSyncedAt)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort();

  return timestamps.at(-1) ?? null;
}
