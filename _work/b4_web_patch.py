root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\apps\web\src'


def patch(path, pairs):
    p = root + '\\' + path
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, s.count(a), a[:80])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8').write(s)


patch(r'components\contract\types.ts', [
    ("""  signaturesRequired: number;
}

export interface ContractAward""", """  signaturesRequired: number;
  docType?: 'CONTRACT' | 'NDA' | 'CONFIDENTIALITY' | 'MASTER';
  signingMode?: 'STANDARD' | 'BLIND' | 'STAGED';
}

export interface CheckRow {
  kind: 'TENDER_CONSISTENCY' | 'VENDOR_PREFLIGHT' | 'RECHECK';
  key: string;
  label: string;
  result: 'PASS' | 'WARN' | 'FAIL' | 'REVIEWED';
  detail: string;
  reviewNote: string | null;
}

export interface ContractAward"""),
    ("""    templateText: string;
    currentText: string;
  }>;""", """    templateText: string;
    currentText: string;
    protected: boolean;
    acceptances: Array<{ by: string; stamp: string | null; statement: string | null }>;
  }>;
  endorsements: {
    required: string[];
    done: Array<{ role: string; by: string; at: string; comment: string | null }>;
    missing: string[];
  };
  checks: { tender: CheckRow[]; vendor: CheckRow[]; recheck: CheckRow[] };
  negotiation: { locked: boolean; lockAt: string; daysOpen: number; limitDays: number };
  blind: boolean;
  signatureBlocks: Array<{ role: string; label?: string; position?: string }>;"""),
    ("""    canVary: boolean;
    canEditRecord: boolean;
  };""", """    canVary: boolean;
    canEditRecord: boolean;
    canEndorse: boolean;
    canRunChecks: boolean;
    canComment: boolean;
    canAskQuestion: boolean;
  };"""),
])

patch(r'components\contract\contract-workspace.tsx', [
    ("import { ManagementCard } from './management-card';", """import { ManagementCard } from './management-card';
import {
  ChecksCard,
  CollabCard,
  ContractBanners,
  DeviationTools,
  EndorsementsCard,
  QuestionsCard,
  RiskSummaryCard,
  SigningCard,
  StrategyCard,
} from './b4-panels';"""),
    ("export function ContractWorkspace({ initial, csrf }: { initial: ContractView; csrf: string }) {", "export function ContractWorkspace({\n  initial,\n  csrf,\n  roles = [],\n}: {\n  initial: ContractView;\n  csrf: string;\n  roles?: string[];\n}) {"),
    ("  const [comment, setComment] = useState('');\n  const [terms,", "  const [comment, setComment] = useState('');\n  const [signingMode, setSigningMode] = useState<'STANDARD' | 'BLIND' | 'STAGED'>('STANDARD');\n  const [terms,"),
    ("      () => api<ContractView>(`/contracts/${c.id}/release-for-signing`, { method: 'POST', csrf }),", "      () =>\n        api<ContractView>(`/contracts/${c.id}/release-for-signing`, {\n          method: 'POST',\n          csrf,\n          body: { signingMode },\n        }),"),
    ("""            <span className="font-mono text-lg text-text-muted">{c.number}</span> {c.title ?? 'Contract'}
          </h1>
          <Badge tone={tone}>{statusLabel}</Badge>""", """            <span className="font-mono text-lg text-text-muted">{c.number}</span> {c.title ?? 'Contract'}
          </h1>
          <Badge tone={tone}>{statusLabel}</Badge>
          {c.docType && c.docType !== 'CONTRACT' && (
            <Badge tone="info">
              {{ NDA: 'Non-disclosure agreement', CONFIDENTIALITY: 'Confidentiality agreement', MASTER: 'Master agreement' }[c.docType]}
            </Badge>
          )}
          {c.signingMode && c.signingMode !== 'STANDARD' && (
            <Badge tone="neutral">{c.signingMode === 'BLIND' ? 'Blind signing' : 'Staged signing'}</Badge>
          )}"""),
    ("      {c.locked && (\n        <p\n          role=\"status\"", "      <ContractBanners c={c} />\n      {c.locked && (\n        <p\n          role=\"status\""),
    ("""                      {!x.decision && (x.mandatory || x.risk === 'HIGH') && (
                        <Badge tone="warning">Needs a delegate</Badge>
                      )}""", """                      {x.protected && <Badge tone="error">Non-negotiable clause</Badge>}
                      {!x.decision && x.protected && (
                        <Badge tone="warning">Needs General Counsel or the risk delegate</Badge>
                      )}
                      {!x.decision && !x.protected && (x.mandatory || x.risk === 'HIGH') && (
                        <Badge tone="warning">Needs a delegate</Badge>
                      )}"""),
    ("""                    {x.stamp && <p className="mt-1 font-mono text-xs text-text-muted">{x.stamp}</p>}""", """                    {x.stamp && <p className="mt-1 font-mono text-xs text-text-muted">{x.stamp}</p>}
                    {x.acceptances.map((y) => (
                      <p key={y.stamp} className="mt-1 text-xs text-text-muted">
                        {y.stamp}: {y.statement}
                      </p>
                    ))}"""),
    ("""                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">""", """                      </div>
                    )}
                    <DeviationTools
                      c={c}
                      csrf={csrf}
                      roles={roles}
                      onChange={setC}
                      clauseId={x.clauseId}
                      title={x.title}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ChecksCard c={c} csrf={csrf} roles={roles} onChange={setC} />
          <EndorsementsCard c={c} csrf={csrf} roles={roles} onChange={setC} />
          <CollabCard c={c} csrf={csrf} roles={roles} onChange={setC} />
          <StrategyCard c={c} csrf={csrf} roles={roles} onChange={setC} />
        </div>

        <aside className="flex flex-col gap-6">"""),
    ("""            <div className="mt-3 flex flex-wrap gap-2">
              {p.canRelease && (
                <Button loading={busy === 'release'} onClick={() => void release()}>
                  Release for signing
                </Button>
              )}""", """            {p.canRelease && (
              <div className="mt-3">
                <Field label="How signatures are collected">
                  <Select
                    value={signingMode}
                    onChange={(e) => setSigningMode(e.target.value as typeof signingMode)}
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="BLIND">Blind: signatories see no one else&apos;s signature</option>
                    <option value="STAGED">Staged: signed in sequence</option>
                  </Select>
                </Field>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {p.canRelease && (
                <Button loading={busy === 'release'} onClick={() => void release()}>
                  Release for signing
                </Button>
              )}"""),
    ("""          </Card>
        </aside>
      </div>
""", """          </Card>
          <SigningCard c={c} csrf={csrf} roles={roles} onChange={setC} />
          <RiskSummaryCard c={c} csrf={csrf} roles={roles} onChange={setC} />
          <QuestionsCard c={c} csrf={csrf} roles={roles} onChange={setC} />
        </aside>
      </div>
"""),
])
patch(r'app\app\contracts\[id]\page.tsx', [("<ContractWorkspace initial={res.data} csrf={user.csrfToken} />", "<ContractWorkspace initial={res.data} csrf={user.csrfToken} roles={user.roles} />")])
print('ok')
