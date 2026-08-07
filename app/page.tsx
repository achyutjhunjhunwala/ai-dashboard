import Dashboard from './dashboard';
import { getCurrentMonthUsage } from '../lib/usage';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const initialData = await getCurrentMonthUsage();

  return <Dashboard initialData={initialData} />;
}
