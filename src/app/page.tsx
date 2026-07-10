import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard'); // 301 by default in Next.js
  return null;
}
