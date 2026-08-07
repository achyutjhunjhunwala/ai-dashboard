import { mkdir, writeFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

const claudeUsagePath = path.join(process.cwd(), 'data', 'claude-usage.json');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { spendUsd, inputTokens, outputTokens, cacheReadTokens, requestCount } = body;

    if (typeof spendUsd !== 'number') {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    await mkdir(path.dirname(claudeUsagePath), { recursive: true });
    await writeFile(
      claudeUsagePath,
      JSON.stringify(
        { spendUsd, inputTokens, outputTokens, cacheReadTokens, requestCount },
        null,
        2,
      ) + '\n',
      'utf8',
    );

    return NextResponse.json({
      success: true,
      updated: { spendUsd, inputTokens, outputTokens, cacheReadTokens, requestCount },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
