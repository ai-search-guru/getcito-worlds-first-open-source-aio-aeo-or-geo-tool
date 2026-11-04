import { redirect } from 'next/navigation';
import { DASHBOARD_HOME } from '@/config/home';

// Actions is the Action Center's first tab.
export default function ActionCenterPage() {
  redirect(DASHBOARD_HOME);
}
