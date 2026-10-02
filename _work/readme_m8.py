p = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\README.md'
t = open(p, encoding='utf8', newline='').read()
old = t[t.index('Conversational source-to-contract'):t.index('- Documents:')]
new = ('Conversational source-to-contract procurement portal proof of concept. **Status: Phase 5, milestones M0–M8 complete** '
       '(foundation, design system, data/audit core, identity & access, app shell, request intake, procurement plan, '
       'tender pack and supplier portal). Later modules (evaluation, contracts, reporting, admin) are "Coming soon" placeholders. '
       'Voice dictation (speech to text) works in Chrome and Edge in the request chat and the plan instruction box.\n\n')
t = t.replace(old, new)
marker = '## Checks'
section = '''## Try the tender and supplier journey

1. Sign in as `requester@…`, create and submit a request (about $90,000 keeps approvals simple).
2. As `procurement@…` open the plan and send it for approval; as `delegate@…` approve it.
3. As `procurement@…` open **Tenders** and create the tender pack. It stays **staged** (invisible to suppliers).
4. As `delegate@…` open **Approvals** and give permission to publish. Then, as `procurement@…`, publish with a closing time at least 25 days out (the demo organisation is public-sector) and invite a supplier. Email is simulated: copy the registration link shown.
5. Open the link in a private window, register (the ABN must pass the real checksum, for example `65 000 000 101`), sign in, ask a question, upload a technical and a commercial file and submit to get a receipt.
6. Back as `procurement@…`, answer the question and issue an addendum. The question's author is never shown. Bids stay sealed until the closing time.

The seeded supplier `supplier@…` already has a closed, submitted tender and an open one to explore. Bid files are stored sealed under `apps/api/var/storage`.

'''
t = t.replace(marker, section + marker, 1)
open(p, 'w', encoding='utf8', newline='').write(t)
print('ok')
