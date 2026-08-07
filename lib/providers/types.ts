import type { ProviderId, ProviderUsage } from '../types';

export type ProviderAdapter = {
  id: ProviderId;
  syncCurrentMonth(): Promise<ProviderUsage>;
};
