import { redirect } from 'next/navigation';
import { DASHBOARD_HOME } from '@/config/home';

export default function DashboardPage() {
  redirect(DASHBOARD_HOME);
}
