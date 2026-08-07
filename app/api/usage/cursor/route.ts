import { mkdir, writeFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

const cursorUsagePath = path.join(process.cwd(), 'data', 'cursor-usage.json');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { requestsUsed, requestsTotal, resetsAt } = body;

    if (typeof requestsUsed !== 'number' || typeof requestsTotal !== 'number' || !resetsAt) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    await mkdir(path.dirname(cursorUsagePath), { recursive: true });
    await writeFile(
      cursorUsagePath,
      JSON.stringify({ requestsUsed, requestsTotal, resetsAt }, null, 2) + '\n',
      'utf8',
    );

    return NextResponse.json({
      success: true,
      updated: { requestsUsed, requestsTotal, resetsAt },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
