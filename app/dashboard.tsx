'use client';

import { useState } from 'react';

import type { DashboardData, ProviderUsage } from '../lib/types';

export default function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function refreshUsage() {
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const response = await fetch('/api/usage/current-month', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      setData((await response.json()) as DashboardData);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">The Ui Guy</p>
          <h1>Usage</h1>
          <p className="heroText">Track various usages</p>
        </div>
        <div className="heroActions">
          <button className="button" disabled={isRefreshing} onClick={refreshUsage}>
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <span className="lastSync">Last sync: {formatDateTime(data.summary.lastSyncedAt)}</span>
        </div>
      </section>

      {refreshError ? <div className="errorBanner">Refresh failed: {refreshError}</div> : null}

      <section
        className="summaryPanel"
        style={{
          marginBottom: '30px',
          padding: '24px',
          borderRadius: '24px',
          background:
            'linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02))',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '20px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)', fontWeight: 500 }}>
              Total USD Spend (Current Month)
            </h3>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '8px' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--foreground)' }}>
                {formatCurrency(data.summary.totalSpendUsd)}
              </span>
              {data.summary.totalBudgetUsd !== null ? (
                <span style={{ fontSize: '1.2rem', color: 'var(--muted)' }}>
                  / {formatCurrency(data.summary.totalBudgetUsd)} limit
                </span>
              ) : null}
            </div>
          </div>

          {data.summary.totalBudgetUsd !== null && data.summary.percentUsed !== null ? (
            <div style={{ flex: '1', minWidth: '280px', maxWidth: '400px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.86rem',
                  color: 'var(--muted)',
                  marginBottom: '8px',
                }}
              >
                <span>{data.summary.percentUsed}% of total limit used</span>
                <span>{formatCurrency(data.summary.totalRemainingUsd)} remaining</span>
              </div>
              <div className="progressTrack">
                <div
                  className="progressFill"
                  style={{
                    width: `${Math.min(100, data.summary.percentUsed)}%`,
                    background: getProgressColor(data.summary.percentUsed),
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <ProviderGrid providers={data.providers} />

      <footer
        style={{
          marginTop: '60px',
          padding: '24px 0',
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: '0.88rem',
          letterSpacing: '0.02em',
        }}
      >
        created with ❤️ in Berlin by The Ui Guy
      </footer>
    </main>
  );
}

function ProviderGrid({ providers }: { providers: ProviderUsage[] }) {
  return (
    <section className="providerGrid">
      {providers.map((provider) => (
        <article
          className={`providerCard ${provider.status === 'error' ? 'providerCard-error' : ''}`}
          key={provider.provider}
          style={
            provider.status === 'error'
              ? {
                  border: '1px solid #ef4444',
                  boxShadow: '0 0 16px rgba(239, 68, 68, 0.15)',
                  background:
                    'linear-gradient(180deg, rgba(239, 68, 68, 0.04) 0%, rgba(255, 255, 255, 0.02) 100%)',
                }
              : undefined
          }
        >
          <div className="providerHeader">
            <div>
              <h2>{provider.displayName}</h2>
            </div>
            <StatusBadge status={provider.status} />
          </div>

          {provider.provider === 'github_copilot' ? (
            <div className="budgetOverview" style={{ marginTop: '22px', marginBottom: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.88rem',
                  color: 'var(--muted)',
                }}
              >
                <span>
                  Used:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {Number(provider.metadata?.creditsUsed ?? 0).toLocaleString()} credits
                    {provider.spendToday !== null && provider.spendToday > 0 ? (
                      <span
                        style={{
                          color: 'var(--accent)',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          marginLeft: '6px',
                        }}
                      >
                        (+{Number(provider.spendToday / 0.01).toLocaleString()} credits today)
                      </span>
                    ) : null}
                  </strong>
                </span>
                <span>
                  Limit:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {Number(provider.metadata?.creditsTotal ?? 100000).toLocaleString()} credits
                  </strong>
                </span>
              </div>

              <div className="progressTrack" style={{ marginTop: '10px' }}>
                <div
                  className="progressFill"
                  style={{
                    width: `${Math.min(100, provider.percentUsed ?? 0)}%`,
                    background: getProgressColor(provider.percentUsed),
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.82rem',
                  marginTop: '8px',
                  color: 'var(--muted)',
                }}
              >
                <span>{provider.percentUsed ?? 0}% Used</span>
                <span>
                  {Number(
                    ((provider.metadata?.creditsTotal as number) ?? 100000) -
                      ((provider.metadata?.creditsUsed as number) ?? 0),
                  ).toLocaleString()}{' '}
                  credits remaining
                </span>
              </div>
            </div>
          ) : provider.provider === 'chatgpt_enterprise' ? (
            <div className="budgetOverview" style={{ marginTop: '22px', marginBottom: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.88rem',
                  color: 'var(--muted)',
                }}
              >
                <span>
                  Used:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {Number(provider.metadata?.creditsUsed ?? 0).toLocaleString()} credits
                    {provider.spendToday !== null ? (
                      <span
                        style={{
                          color: provider.spendToday > 0 ? 'var(--accent)' : 'var(--muted)',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          marginLeft: '6px',
                        }}
                      >
                        (+{Number(provider.spendToday).toLocaleString()} credits today)
                      </span>
                    ) : null}
                  </strong>
                </span>
                <span>
                  Limit:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {Number(provider.metadata?.creditsTotal ?? 5000).toLocaleString()} credits
                  </strong>
                </span>
              </div>

              <div className="progressTrack" style={{ marginTop: '10px' }}>
                <div
                  className="progressFill"
                  style={{
                    width: `${Math.min(100, provider.percentUsed ?? 0)}%`,
                    background: getProgressColor(provider.percentUsed),
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.82rem',
                  marginTop: '8px',
                  color: 'var(--muted)',
                }}
              >
                <span>{provider.percentUsed ?? 0}% Used</span>
                <span>
                  {Number(
                    ((provider.metadata?.creditsTotal as number) ?? 5000) -
                      ((provider.metadata?.creditsUsed as number) ?? 0),
                  ).toLocaleString()}{' '}
                  credits remaining
                </span>
              </div>
            </div>
          ) : provider.provider === 'cursor_pro' ? (
            <div className="budgetOverview" style={{ marginTop: '22px', marginBottom: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.88rem',
                  color: 'var(--muted)',
                }}
              >
                <span>
                  Used:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {formatCurrency(((provider.metadata?.requestsUsed as number) ?? 0) / 100)}
                    {provider.spendToday !== null ? (
                      <span
                        style={{
                          color: provider.spendToday > 0 ? 'var(--accent)' : 'var(--muted)',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          marginLeft: '6px',
                        }}
                      >
                        (+{formatCurrency(provider.spendToday)} today)
                      </span>
                    ) : null}
                  </strong>
                </span>
                <span>
                  Limit:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {formatCurrency(((provider.metadata?.requestsTotal as number) ?? 100000) / 100)}
                  </strong>
                </span>
              </div>

              <div className="progressTrack" style={{ marginTop: '10px' }}>
                <div
                  className="progressFill"
                  style={{
                    width: `${Math.min(100, provider.percentUsed ?? 0)}%`,
                    background: getProgressColor(provider.percentUsed),
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.82rem',
                  marginTop: '8px',
                  color: 'var(--muted)',
                }}
              >
                <span>{provider.percentUsed ?? 0}% Used</span>
                <span>
                  {formatCurrency(
                    (((provider.metadata?.requestsTotal as number) ?? 100000) -
                      ((provider.metadata?.requestsUsed as number) ?? 0)) /
                      100,
                  )}{' '}
                  remaining
                </span>
              </div>
            </div>
          ) : provider.spendUsd !== null || provider.budgetUsd !== null ? (
            <div className="budgetOverview" style={{ marginTop: '22px', marginBottom: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.88rem',
                  color: 'var(--muted)',
                }}
              >
                <span>
                  Spent:{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {formatCurrency(provider.spendUsd ?? 0)}
                    {provider.spendToday !== null ? (
                      <span
                        style={{
                          color: provider.spendToday > 0 ? 'var(--accent)' : 'var(--muted)',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          marginLeft: '6px',
                        }}
                      >
                        (+{formatCurrency(provider.spendToday)} today)
                      </span>
                    ) : null}
                  </strong>
                </span>
                {provider.budgetUsd !== null ? (
                  <span>
                    Budget:{' '}
                    <strong style={{ color: 'var(--foreground)' }}>
                      {formatCurrency(provider.budgetUsd)}
                    </strong>
                  </span>
                ) : (
                  <span style={{ fontStyle: 'italic', fontSize: '0.82rem' }}>
                    No Budget Limit Set
                  </span>
                )}
              </div>

              {provider.budgetUsd !== null ? (
                <>
                  <div className="progressTrack" style={{ marginTop: '10px' }}>
                    <div
                      className="progressFill"
                      style={{
                        width: `${Math.min(100, provider.percentUsed ?? 0)}%`,
                        background: getProgressColor(provider.percentUsed),
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      marginTop: '8px',
                      color: 'var(--muted)',
                    }}
                  >
                    <span>{provider.percentUsed ?? 0}% Used</span>
                    <span>
                      {formatCurrency(provider.remainingUsd ?? provider.budgetUsd)} Remaining
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {provider.metadata ? (
            <dl className="metadataList">
              {Object.entries(provider.metadata)
                .filter(
                  ([key]) =>
                    (provider.provider !== 'chatgpt_enterprise' &&
                      provider.provider !== 'cursor_pro' &&
                      provider.provider !== 'github_copilot') ||
                    key === 'resetsAt' ||
                    key === 'resetDate',
                )
                .map(([key, value]) => (
                  <Metric
                    key={key}
                    label={humanizeKey(key)}
                    value={formatMetadataValue(key, value)}
                  />
                ))}
            </dl>
          ) : null}

          {provider.status === 'error' && provider.message ? (
            <div
              style={{
                marginTop: '18px',
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'rgba(255, 138, 154, 0.12)',
                color: '#ffd5db',
                border: '1px solid rgba(255, 138, 154, 0.3)',
                fontSize: '0.84rem',
                fontWeight: 600,
              }}
            >
              ⚠️ {provider.message}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function StatusBadge({ status }: { status: ProviderUsage['status'] }) {
  return <span className={`status status-${status}`}>{status.replace('_', ' ')}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Not available';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Never';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMetadataValue(key: string, value: string | number | null) {
  if (value === null) {
    return 'Not available';
  }

  if (typeof value === 'number') {
    const lowerKey = key.toLowerCase();
    const isMoney =
      lowerKey.includes('spend') ||
      lowerKey.includes('credits') ||
      lowerKey.includes('balance') ||
      lowerKey.includes('budget') ||
      lowerKey.includes('override') ||
      lowerKey.includes('cost');

    return isMoney ? formatCurrency(value) : value.toLocaleString('en-US');
  }

  return value;
}

function humanizeKey(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
}

function getProgressColor(percent: number | null): string | undefined {
  if (percent === null) return undefined;
  if (percent >= 80) return 'linear-gradient(90deg, #ef4444, #dc2626)'; // Red
  if (percent >= 50) return 'linear-gradient(90deg, #f59e0b, #d97706)'; // Yellow/Amber
  return undefined; // Default (falls back to default CSS theme)
}
