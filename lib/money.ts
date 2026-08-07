export function parseMoney(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateBudgetFields(spendUsd: number | null, budgetUsd: number | null) {
  if (spendUsd === null || budgetUsd === null || budgetUsd <= 0) {
    return {
      remainingUsd: budgetUsd,
      percentUsed: null,
    };
  }

  return {
    remainingUsd: roundMoney(budgetUsd - spendUsd),
    percentUsed: Math.min(100, Math.round((spendUsd / budgetUsd) * 1000) / 10),
  };
}
