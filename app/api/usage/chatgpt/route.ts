import { mkdir, writeFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

const chatgptUsagePath = path.join(process.cwd(), 'data', 'chatgpt-usage.json');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { creditsUsed, creditsTotal, resetsAt } = body;

    if (typeof creditsUsed !== 'number' || typeof creditsTotal !== 'number' || !resetsAt) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    await mkdir(path.dirname(chatgptUsagePath), { recursive: true });
    await writeFile(
      chatgptUsagePath,
      JSON.stringify({ creditsUsed, creditsTotal, resetsAt }, null, 2) + '\n',
      'utf8',
    );

    return NextResponse.json({
      success: true,
      updated: { creditsUsed, creditsTotal, resetsAt },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
