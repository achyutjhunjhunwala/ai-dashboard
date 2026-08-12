export type ProviderId = string;

export type ProviderStatus = 'connected' | 'not_configured' | 'partial' | 'error';

export type ProviderSource = 'api' | 'derived';

export type DailySpend = {
  date: string;
  spendUsd: number;
};

export type ModelBreakdown = {
  model: string;
  spendUsd: number;
  totalTokens?: number;
};

export type ProviderUsage = {
  provider: ProviderId;
  displayName: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  budgetUsd: number | null;
  spendUsd: number | null;
  remainingUsd: number | null;
  percentUsed: number | null;
  spendToday: number | null;
  projectedMonthEndSpendUsd: number | null;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  requestCount?: number;
  dailySpend: DailySpend[];
  modelBreakdown?: ModelBreakdown[];
  source: ProviderSource;
  status: ProviderStatus;
  lastSyncedAt?: string;
  message?: string;
  metadata?: Record<string, string | number | null>;
};

export type DashboardSummary = {
  billingPeriodStart: string;
  billingPeriodEnd: string;
  totalBudgetUsd: number | null;
  totalSpendUsd: number | null;
  totalRemainingUsd: number | null;
  percentUsed: number | null;
  projectedMonthEndSpendUsd: number | null;
  lastSyncedAt: string | null;
};

export type DashboardData = {
  summary: DashboardSummary;
  providers: ProviderUsage[];
};
