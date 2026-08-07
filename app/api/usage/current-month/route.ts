import { NextResponse } from 'next/server';

import { getCurrentMonthUsage } from '../../../../lib/usage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const usage = await getCurrentMonthUsage();
  return NextResponse.json(usage);
}
