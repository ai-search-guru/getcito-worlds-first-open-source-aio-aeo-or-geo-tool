import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/config/api';

const AEO_SERVER_URL = API_BASE_URL;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = request.headers.get('authorization');
  const vercelHeader = request.headers.get('x-vercel-cron-auth');

  const token = vercelHeader ?? authHeader?.replace('Bearer ', '');

  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch(`${AEO_SERVER_URL}/api/internal/daily-tracking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[cron] daily-tracking failed:', err);
    return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 });
  }
}
