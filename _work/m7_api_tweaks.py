root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

def rd(p):
    return open(root + '\\' + p, encoding='utf8', newline='').read()

def wr(p, t):
    open(root + '\\' + p, 'w', encoding='utf8', newline='').write(t)

p = r'_work\gen_openapi.py'
t = rd(p)
old = '"permissions": ref("PlanPermissions"), "undoAvailable": B}'
assert old in t
t = t.replace(old, '"permissions": ref("PlanPermissions"), "undoAvailable": B, "undoToken": S}')
wr(p, t)

# session helper that also reports the HTTP status (so pages can explain a 409 instead of showing a blank)
p = r'apps\web\src\lib\session.ts'
t = rd(p)
t += '''
/** Like apiGet, but keeps the status and problem code so a page can explain *why* something is unavailable. */
export async function apiGetResult<T>(path: string): Promise<{ status: number; data: T | null; code?: string }> {
  const cookie = await cookieHeader();
  if (!cookie) return { status: 401, data: null };
  try {
    const r = await fetch(`${API}/api/v1${path}`, { headers: { cookie }, cache: 'no-store' });
    const body = (await r.json().catch(() => null)) as (T & { code?: string }) | null;
    return r.ok ? { status: r.status, data: body as T } : { status: r.status, data: null, ...(body?.code ? { code: body.code } : {}) };
  } catch {
    return { status: 0, data: null };
  }
}
'''
wr(p, t)

p = r'apps\web\src\lib\labels.ts'
t = rd(p)
t += '''
export const PLAN_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  AWAITING_SIGNOFF: 'Awaiting checks',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED_LOCKED: 'Approved and locked',
  REOPENED: 'Reopened',
  REJECTED: 'Returned',
};
export const PLAN_STATUS_TONE: Record<string, BadgeTone> = {
  NOT_STARTED: 'neutral',
  DRAFT: 'neutral',
  AWAITING_SIGNOFF: 'warning',
  AWAITING_APPROVAL: 'info',
  APPROVED_LOCKED: 'success',
  REOPENED: 'warning',
  REJECTED: 'error',
};
export const COI_LABEL: Record<string, string> = { PENDING: 'Awaiting decision', IMMATERIAL: 'No conflict / immaterial', MANAGEABLE: 'Manageable', MATERIAL: 'Material' };
export const COI_TONE: Record<string, BadgeTone> = { PENDING: 'warning', IMMATERIAL: 'success', MANAGEABLE: 'info', MATERIAL: 'error' };
'''
wr(p, t)
print('ok')
