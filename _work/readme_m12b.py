r = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC\README.md'
s = open(r, encoding='utf8', newline='').read()
add = """## Try the follow-up features

- **Contracts:** as `legal@...` draft a contract, change a mandatory clause (for example liability): it is rated for risk and `delegate@...` must approve it before release. After signing, `contract-mgr@...` can edit milestones and extensions, change the owner and add an alert in plain language (for example "alert me 1 year before expiry and include whoever is my manager then"). `legal@...` can create a **variation**, which is signed like a contract and adds to the cumulative value.
- **Administration:** `admin@...` opens **Delegations** to change a signing or approval limit (it applies to the very next signature) and the timing of contract alerts. Raise `exec@...` a signing limit to complete contracts above 1,000,000.
- **Suppliers:** `procurement@...` opens **Suppliers** for each supplier's screening status and contacts, and adds a contact who activates their account through a one-time link (shown once; no email is sent).
- **Reports:** `exec@...` opens **Reports** for spend by category (with drill-down) and by supplier, off-contract spend, workload by owner and a procurement timeline.
- **Evaluation:** the chair can set the variance limit per evaluation before consensus opens; `probity@...` records a sign-off once consensus is locked. The evaluation report downloads as PDF or Word, and so does a tender pack.
- Existing dev databases need `npm run db:reset` for the new tables and seed data.

## Checks
"""
assert "## Checks\n" in s
s = s.replace("## Checks\n", add, 1)
open(r, 'w', encoding='utf8', newline='').write(s)
print('ok')
