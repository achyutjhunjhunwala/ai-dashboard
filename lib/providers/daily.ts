import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { roundMoney } from '../money';

type DailySnapshot = {
  date: string;
  capturedAt: string;
  value: number;
};

export async function calculateDailySpend(
  snapshotFileName: string,
  currentValue: number,
): Promise<number> {
  const todayStr = new Date().toISOString().slice(0, 10);
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

  // Find yesterday's or previous day's last snapshot
  const priorSnapshots = updatedSnapshots.filter((s) => s.date < todayStr);
  if (priorSnapshots.length === 0) {
    return 0; // No baseline to compare, today's spend is 0
  }

  const lastPrior = priorSnapshots[priorSnapshots.length - 1];
  return Math.max(0, roundMoney(currentValue - lastPrior.value));
}
