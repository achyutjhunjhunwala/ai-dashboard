import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow } from '../dates';
import { roundMoney } from '../money';

type DailySnapshot = {
  date: string;
  capturedAt: string;
  value: number;
};

export async function calculateDailySpend(
  snapshotFileName: string,
  currentValue: number,
  billingPeriodStart?: string,
): Promise<number> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const periodStart = billingPeriodStart ?? getCurrentMonthWindow().startDate;
  const snapshotFilePath = path.join(process.cwd(), 'data', snapshotFileName);

  const snapshot: DailySnapshot = {
    date: todayStr,
    capturedAt: new Date().toISOString(),
    value: currentValue,
  };

  let snapshots: DailySnapshot[] = [];
  try {
    const raw = await readFile(snapshotFilePath, 'utf8');
    snapshots = JSON.parse(raw);
  } catch {
    // Start fresh if file is missing
  }

  // Filter out today's previous records and keep only older ones
  const withoutToday = snapshots.filter((s) => s.date !== todayStr);
  const updatedSnapshots = [...withoutToday, snapshot].sort((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt),
  );

  // Write updated list
  await mkdir(path.dirname(snapshotFilePath), { recursive: true });
  await writeFile(snapshotFilePath, JSON.stringify(updatedSnapshots, null, 2) + '\n', 'utf8');

  // Find snapshots within the current billing cycle before today
  const priorSnapshotsInCycle = updatedSnapshots.filter(
    (s) => s.date >= periodStart && s.date < todayStr,
  );

  if (priorSnapshotsInCycle.length === 0) {
    // No prior baseline within current billing cycle - baseline was 0 at cycle start
    return roundMoney(currentValue);
  }

  const lastPrior = priorSnapshotsInCycle[priorSnapshotsInCycle.length - 1];
  if (currentValue < lastPrior.value) {
    return roundMoney(currentValue);
  }

  return roundMoney(currentValue - lastPrior.value);
}
