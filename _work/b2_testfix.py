p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\api\src\modules\tender\b2.test.ts'
s = open(p, encoding='utf8').read()


def sub(a, b, count=1):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, count)


sub("expect(sub.statusCode, sub.body).toBe(200);", "expect(sub.statusCode, sub.body).toBe(201);")
sub("import { emailFor, seedDatabase, uid } from '../../db/seed.js';", "import { emailFor, seedDatabase, TENANT_ID, uid } from '../../db/seed.js';")
# a call that never retries, to prove a session has ended
sub("const anon = (method: 'GET' | 'POST'", """/** One attempt with the cookies already held: no fresh sign-in, so a 401 is reported rather than hidden. */
async function callHeld(key: string, url: string) {
  const sess = await sessionFor(key);
  return app.inject({ method: 'GET', url: `/api/v1${url}`, cookies: sess.cookies });
}
const anon = (method: 'GET' | 'POST'""")
sub("expect((await call('new.colleague@teamco.example', 'GET', '/supplier/tenders')).statusCode).toBe(401); // sessions ended",
    "expect((await callHeld('new.colleague@teamco.example', '/supplier/tenders')).statusCode).toBe(401); // sessions ended")
sub("""    // a second supplier: the permission runs out
    const c = await register(t.id, 'Slowco').catch(() => null);
    void c;
""", "")
# FR-0190 test, written properly
a = s.index("describe('tender administrators cannot evaluate (FR-0190)'")
s = s[:a] + """describe('tender administrators cannot evaluate (FR-0190)', () => {
  it('a procurement lead, a probity officer or an administrator cannot be put on an evaluation panel, even if they also hold the evaluator role; a clean panel can', async () => {
    const t = await publishedTender(90_000, 26);
    const a = await register(t.id, 'Panelled');
    await fullBid(a.key, t.id);
    clock.advanceDays(27);
    // two people who run or oversee tenders are also given the evaluator role
    await sys((tx) =>
      tx.insert(s.roleAssignment).values([
        { tenantId: TENANT_ID, userId: uid('user:procurement'), role: 'EVALUATOR' },
        { tenantId: TENANT_ID, userId: uid('user:probity'), role: 'EVALUATOR' },
      ]),
    );
    const tech = uid('user:evaluator-tech');
    const comm = uid('user:evaluator-comm');
    for (const bad of ['procurement', 'probity']) {
      const open = await call('procurement', 'POST', `/tenders/${t.id}/evaluation`, { panel: [{ userId: uid(`user:${bad}`), stream: 'TECHNICAL' }, { userId: comm, stream: 'COMMERCIAL' }] });
      expect(open.statusCode, `${bad}: ${open.body}`).toBe(403);
      expect(open.json().code).toBe('ROLE_SOD_VIOLATION');
      expect(JSON.stringify(open.json())).toContain('FR-0190');
    }
    const ok = await call('procurement', 'POST', `/tenders/${t.id}/evaluation`, { panel: [{ userId: tech, stream: 'TECHNICAL' }, { userId: comm, stream: 'COMMERCIAL' }] });
    expect(ok.statusCode, ok.body).toBe(201);
    // and later, adding one of them is refused as well
    const add = await call('procurement', 'POST', `/evaluations/${ok.json().id}/panel`, { userId: uid('user:probity'), stream: 'TECHNICAL' });
    expect(add.statusCode).toBe(403);
    expect(add.json().code).toBe('ROLE_SOD_VIOLATION');
  });
});
"""
open(p, 'w', encoding='utf8').write(s)
print('ok')
