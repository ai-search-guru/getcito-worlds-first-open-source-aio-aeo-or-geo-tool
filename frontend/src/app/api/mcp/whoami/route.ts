import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getMeFor } from '@/lib/mcp/account';

/** Who the key acts as, with their role and work areas, as the MCP tool get_me answers. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const me = await getMeFor(auth);
    return NextResponse.json({
      userId: me.user_id,
      email: me.email,
      organizationId: me.organization_id,
      organizationName: me.organization_name,
      role: me.role,
      workAreas: me.work_areas,
      canManageMenus: me.can_manage_menus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
