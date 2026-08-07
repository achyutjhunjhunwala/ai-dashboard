export function getCurrentMonthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    start,
    end,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  };
}

export function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getDaysElapsedInMonth(now = new Date()) {
  return now.getUTCDate();
}

export function getDaysInMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

export function projectMonthEndSpend(spendUsd: number | null, now = new Date()) {
  if (spendUsd === null) {
    return null;
  }

  const daysElapsed = Math.max(getDaysElapsedInMonth(now), 1);
  return (spendUsd / daysElapsed) * getDaysInMonth(now);
}
