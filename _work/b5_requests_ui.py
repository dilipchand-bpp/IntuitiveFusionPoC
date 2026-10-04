p = 'apps/web/src/app/app/requests/page.tsx'
s = open(p, encoding='utf8', newline='').read()


def rep(old, new, n=1):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, n)


rep("""  estimatedValue: number;
  updatedAt: string;
}""", """  estimatedValue: number;
  updatedAt: string;
  /** Set when the procurement was started from a contract to renew, vary or extend it. */
  linkKind?: 'RENEW' | 'VARY' | 'EXTEND';
  linkedContract?: { id: string; number: string | null };
}
const LINK_LABEL = { RENEW: 'Renewal of', VARY: 'Variation of', EXTEND: 'Extension of' } as const;
function LinkedBadge({ r }: { r: Item }) {
  if (!r.linkKind || !r.linkedContract) return null;
  return (
    <Badge tone="info">
      {LINK_LABEL[r.linkKind]} {r.linkedContract.number ?? 'a contract'}
    </Badge>
  );
}""")
rep("const PHASE_ORDER = ['INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT'];",
    "const PHASE_ORDER = ['INTAKE', 'PLAN', 'TENDER', 'EVALUATION', 'CONTRACT_AWARD', 'CONTRACT_MGMT'];")
rep('md:grid-cols-2 xl:grid-cols-5" data-testid="board"', 'md:grid-cols-2 xl:grid-cols-6" data-testid="board"')
rep("""                          <Link href={`/app/requests/${r.id}`} className="font-semibold">
                            {r.title}
                          </Link>
                          <span className="mt-1 block text-xs text-text-muted">""", """                          <Link href={`/app/requests/${r.id}`} className="font-semibold">
                            {r.title}
                          </Link>
                          <LinkedBadge r={r} />
                          <span className="mt-1 block text-xs text-text-muted">""")
rep("""                          <Link href={`/app/requests/${r.id}`} className="font-semibold">
                            {r.title}
                          </Link>
                          <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>""", """                          <Link href={`/app/requests/${r.id}`} className="font-semibold">
                            {r.title}
                          </Link>
                          <LinkedBadge r={r} />
                          <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>""")
rep("""                        <Link href={`/app/requests/${r.id}`}>{r.title}</Link>
                      </Td>""", """                        <Link href={`/app/requests/${r.id}`}>{r.title}</Link> <LinkedBadge r={r} />
                      </Td>""")
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
