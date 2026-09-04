import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCurrentMonthWindow, getTodayDateString, getYesterdayDateString } from '../dates';
import { roundMoney } from '../money';

export type DailySnapshot = {
  date: string;
  capturedAt: string;
  value: number;
  firstCapturedAt?: string;
  firstValue?: number;
};

export async function calculateDailySpend(
  snapshotFileName: string,
  currentValue: number,
  billingPeriodStart?: string,
  now = new Date(),
): Promise<number> {
  const todayStr = getTodayDateString(now);
  const yesterdayStr = getYesterdayDateString(now);
  const periodStart = billingPeriodStart ?? getCurrentMonthWindow(now).startDate;
  const snapshotFilePath = path.join(process.cwd(), 'data', snapshotFileName);

  let snapshots: DailySnapshot[] = [];
  try {
    const raw = await readFile(snapshotFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      snapshots = parsed;
    }
  } catch {
    // Start fresh if file is missing
  }

  const existingToday = snapshots.find((s) => s.date === todayStr);
  const firstValue = existingToday?.firstValue ?? existingToday?.value ?? currentValue;
  const firstCapturedAt =
    existingToday?.firstCapturedAt ?? existingToday?.capturedAt ?? now.toISOString();

  const snapshot: DailySnapshot = {
    date: todayStr,
    capturedAt: now.toISOString(),
    value: currentValue,
    firstCapturedAt,
    firstValue,
  };

  // Filter out today's previous records and keep only older ones
  const withoutToday = snapshots.filter((s) => s.date !== todayStr);
  const updatedSnapshots = [...withoutToday, snapshot].sort(
    (a, b) => a.date.localeCompare(b.date) || a.capturedAt.localeCompare(b.capturedAt),
  );

  // Write updated list
  await mkdir(path.dirname(snapshotFilePath), { recursive: true });
  await writeFile(snapshotFilePath, JSON.stringify(updatedSnapshots, null, 2) + '\n', 'utf8');

  // Find snapshots within the current billing cycle strictly before today
  const priorSnapshotsInCycle = updatedSnapshots.filter(
    (s) => s.date >= periodStart && s.date < todayStr,
  );

  // 1. If today is the start of the billing cycle (e.g. 1st day of month), spend since 00:00 is today's spend
  if (todayStr === periodStart) {
    return roundMoney(Math.max(0, currentValue));
  }

  // 2. If we have a snapshot from yesterday (the immediately preceding day), compare against yesterday's closing value
  const yesterdaySnapshot = priorSnapshotsInCycle.find((s) => s.date === yesterdayStr);
  if (yesterdaySnapshot) {
    return roundMoney(Math.max(0, currentValue - yesterdaySnapshot.value));
  }

  // 3. If there is no snapshot from yesterday (first time loading in this cycle, or multi-day gap):
  // Compare against today's initial opening snapshot rather than assuming 0 spend at month start.
  return roundMoney(Math.max(0, currentValue - firstValue));
}
