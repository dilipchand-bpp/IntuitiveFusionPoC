import json, csv, collections, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from stories import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs"); os.makedirs(DOCS, exist_ok=True)
R = json.load(open(os.path.join(ROOT, "_work", "register.json"), encoding="utf8"))

# extra overrides to remove orphan stories
FR_OVERRIDE.update({"FR-0065": ["US-PLT-04"], "FR-0066": ["US-PLT-04"], "FR-0750": ["US-ADM-03","US-AIA-02"], "FR-0700": ["US-ADM-02"], "FR-0710": ["US-ADM-02"], "FR-0705": ["US-ADM-02"], "FR-0720": ["US-ADM-02"]})
EXTRA = {"NFR-P03": ["US-PLN-06"], "NFR-U03": ["US-TND-05"], "NFR-U01": ["US-PLT-05", "US-NFR-11"]}

CAT_MOD = {"Request Intake & AI":"INT","Procurement Plan":"PLN","RFx / Tender Collaboration":"TND","Tender Portal":"SUP",
 "Supplier Portal":"SUP","Evaluation":"EVL","Evaluation Report":"EVL","Contract Award & Legal":"CON","Contract Management":"CMG",
 "Reporting & Dashboards":"RPT","Data Migration":"MIG","Admin & Configuration":"ADM","Collaboration & AI Authoring":"AIA","Future Scope":"FUT"}

rows = []; defects = []
xn = 0
for d in R["Functional"][1:]:
    rid = d.get("A", ""); cat = d.get("B", "") or "Request Intake & AI"; desc = (d.get("C", "") or "").strip()
    if not rid:
        xn += 1; rid = f"FR-X{xn:02d}"
        defects.append(f"{rid}: register row has no ID (provisional ID assigned) — '{(desc or d.get('J',''))[:70]}'")
    if not desc:
        defects.append(f"{rid}: requirement description is blank in the register")
    pri = d.get("D", "") or "Unprioritised"
    if rid == "FR-0055": defects.append("FR-0055: description is an open question ('what is next step??'), not a requirement; acceptance criteria exist and were used")
    mod = CAT_MOD.get(cat, "INT")
    if rid in FR_OVERRIDE: stories = FR_OVERRIDE[rid]
    else: stories = FR_CAT.get(cat, [])[:2] if cat != "Future Scope" else FR_CAT[cat]
    if pri == "Won't": tier = "D"
    elif rid in POC_WORKING: tier = "W"
    elif pri == "Could": tier = "D"
    else: tier = "S"
    rows.append(dict(id=rid, type="Functional", cat=cat, pri=pri, tier=tier, stories=stories, mod=mod,
                     src=d.get("E", ""), desc=desc, status=d.get("H", "") or "Draft", note=d.get("J", "")))

for d in R["NonFunctional"][1:]:
    rid = d["A"]; pre = rid.split("-")[1].rstrip("0123456789")
    tier = "W" if rid in NFR_WORKING else "D"
    st = EXTRA.get(rid, []) + NFR_CAT[pre]
    rows.append(dict(id=rid, type="Non-functional", cat=d.get("B", ""), pri=d.get("E", ""), tier=tier, stories=list(dict.fromkeys(st)),
                     mod="PLT", src=d.get("F", ""), desc=d.get("C", ""), status=d.get("G", "Draft"), note=d.get("I", "")))
for d in R["Security"][1:]:
    rid = d["A"]; pre = rid.split("-")[1].rstrip("0123456789")
    tier = "W" if rid in SEC_WORKING else ("S" if rid in SEC_STUB else "D")
    rows.append(dict(id=rid, type="Security", cat=d.get("B", ""), pri=d.get("E", ""), tier=tier, stories=SEC_CAT[pre],
                     mod="PLT", src=d.get("D", ""), desc=d.get("C", ""), status=d.get("F", "Draft"), note=d.get("H", "")))

PRM = [
 ("PRM-01","Public landing page: hero + CTA, features, how-it-works (3-4 steps), illustrations, trust/security/compliance, FAQ, footer with contact and legal links",["US-PLT-01"]),
 ("PRM-02","Branded login with validation, forgot password, role-based redirect; mock authentication with a clear swap point for the real IdP",["US-PLT-02","US-NFR-03"]),
 ("PRM-03","Main application: dashboard with KPIs, sidebar/top navigation per module, profile menu, notifications, logout",["US-RPT-01","US-PLT-04"]),
 ("PRM-04","Routes protected by role",["US-PLT-03","US-NFR-02"]),
 ("PRM-05","Design tokens in a single theme file (colour, type pair, spacing, radius, shadow, icons); WCAG AA verified",["US-PLT-05"]),
 ("PRM-06","Logo used in header, landing, login and favicon",["US-PLT-01","US-PLT-02"]),
 ("PRM-07","Fully responsive (desktop/tablet/mobile) with light/dark mode",["US-PLT-05"]),
 ("PRM-08","Every module: full structure plus 2-3 working functions end-to-end (UI->API->data) on realistic seed data; remaining features stubbed with TODO and 'Coming soon' (never blank)",["US-FUT-01"]),
 ("PRM-09","No secrets in code; input validation; secure defaults; least privilege; audit trail for key actions",["US-NFR-01","US-NFR-02","US-NFR-07"]),
]
for pid, desc, st in PRM:
    rows.append(dict(id=pid, type="Brief (prompt)", cat="Portal / Branding", pri="Must", tier="W", stories=st, mod="PLT", src="Prompt.docx", desc=desc, status="Draft", note=""))

story_ids = {s["id"] for s in S}
bad = [(r["id"], x) for r in rows for x in r["stories"] if x not in story_ids]
assert not bad, bad

# ---- RTM csv + md
for r in rows:
    r["tc"] = "TC-" + r["id"].replace("FR-", "F").replace("NFR-", "N").replace("SEC-", "S").replace("PRM-", "P")
    r["spec"] = f"TS-{r['mod']}"
hdr = ["Req ID","Type","Category","Priority","POC tier","User stories","Spec ref","Test case","Source","Register status"]
with open(os.path.join(DOCS, "RTM.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f); w.writerow(hdr)
    for r in rows: w.writerow([r["id"],r["type"],r["cat"],r["pri"],r["tier"],"; ".join(r["stories"]),r["spec"],r["tc"],r["src"],r["status"]])

cov = collections.defaultdict(list)
for r in rows:
    for s in r["stories"]: cov[s].append(r["id"])
orph = [s["id"] for s in S if s["id"] not in cov]
noStory = [r["id"] for r in rows if not r["stories"]]
tiers = collections.Counter((r["type"], r["tier"]) for r in rows)
pri = collections.Counter((r["type"], r["pri"]) for r in rows)

md = ["# Requirements Traceability Matrix (RTM)", "",
 "**Product:** Intuitive Fusion – Procurement Portal (POC)  |  **Version:** 0.1 DRAFT  |  **Date:** 2026-10-02  |  **Phase:** 1 – Requirements Analysis", "",
 "Baseline sources: Requirements Register v0.2 (FR/NFR/SEC), pitch deck, Prompt.docx portal brief (PRM). Full machine-readable copy: [RTM.csv](RTM.csv).", "",
 "**Chain:** Requirement → User story (G/W/T in [01b-User-Stories.md](01b-User-Stories.md)) → Spec reference (Phase 2) → Test case (authored in Phase 4/5) → Result (filled during build).",
 "Test case IDs are allocated 1:1 in the register's scheme (TC-Fnnnn / TC-Nnn / TC-Snnn); story-level acceptance tests (`AT-<story id>`) carry the executable Given/When/Then. **Results column is intentionally empty until Phase 5** — nothing has been run against code yet.", "",
 "**POC tier key:** `W` = working end-to-end in Phase 5 · `S` = stubbed / mocked behind a swap point ('Coming soon' state) · `D` = deferred or design-only (documented in architecture; not built in POC).", "",
 "## 1. Coverage summary (computed by script from the data below)", "",
 "| Measure | Result |", "|---|---|",
 f"| Requirements traced | {len(rows)} ({sum(1 for r in rows if r['type']=='Functional')} FR, {sum(1 for r in rows if r['type']=='Non-functional')} NFR, {sum(1 for r in rows if r['type']=='Security')} SEC, {len(PRM)} PRM) |",
 f"| Requirements with ≥1 user story | {len(rows)-len(noStory)} / {len(rows)} |",
 f"| User stories with ≥1 requirement (no orphans) | {len(S)-len(orph)} / {len(S)} |",
 f"| Requirements with a test case ID | {len(rows)} / {len(rows)} |",
 f"| Tier W / S / D (all) | {sum(1 for r in rows if r['tier']=='W')} / {sum(1 for r in rows if r['tier']=='S')} / {sum(1 for r in rows if r['tier']=='D')} |", "",
 "| Type | W | S | D |", "|---|---|---|---|"]
for t in ["Functional","Non-functional","Security","Brief (prompt)"]:
    md.append(f"| {t} | {tiers[(t,'W')]} | {tiers[(t,'S')]} | {tiers[(t,'D')]} |")
md += ["", "## 2. Register data-quality defects found while tracing", ""]
md += [f"- {x}" for x in defects]
md += ["- The register's own *Traceability Matrix* tab uses IDs `FR-001…FR-180` (3-digit) whereas the *Functional Requirements* tab uses `FR-0005…FR-0880` (4-digit, step of 5). The two cannot be joined; this RTM uses the Functional tab IDs as authoritative. **Decision needed (Q-07).**",
       "- Many register 'Source' cells reference BRS/DD sections not supplied to this POC; they are carried through unverified.", "",
       "## 3. Matrix", "", "| Req ID | Type | Category | Pri | Tier | Stories | Spec | Test case | Result |", "|---|---|---|---|---|---|---|---|---|"]
for r in rows:
    md.append(f"| {r['id']} | {r['type'][:4]} | {r['cat'][:28]} | {r['pri']} | {r['tier']} | {', '.join(x.replace('US-','') for x in r['stories'])} | {r['spec']} | {r['tc']} | – |")
md += ["", "## 4. Reverse trace: user story → requirements", "", "| Story | Module | Tier | Requirements (count) | Sample |", "|---|---|---|---|---|"]
for s in S:
    c = cov[s["id"]]
    md.append(f"| {s['id']} | {s['mod']} | {s['tier']} | {len(c)} | {', '.join(c[:6])}{'…' if len(c)>6 else ''} |")
open(os.path.join(DOCS, "02-RTM.md"), "w", encoding="utf8").write("\n".join(md) + "\n")

# ---- stories md
m = ["# 01b – Personas, User Journeys and User Stories", "",
 "**Product:** Intuitive Fusion – Procurement Portal (POC)  |  **Version:** 0.1 DRAFT  |  Companion to [01-Requirements-Document.md](01-Requirements-Document.md).", "",
 "Every Given/When/Then below becomes an automated test (`AT-<story id>`) in Phase 5. Tier: **W** working end-to-end in the POC, **S** stub/mock behind swap point, **D** design-only.", "",
 "## 1. Personas and roles", "", "| ID | Persona | RBAC role | Profile | Pain point |", "|---|---|---|---|---|"]
for p in PERSONAS: m.append(f"| {p[0]} | {p[1]} | `{p[2]}` | {p[3]} | {p[4]} |")
m += ["", "## 2. User journeys", ""]
journeys = [
 ("J1 – Request to approved plan (P1, P2, P3)", "Requester describes need → assistant asks follow-ups → complexity scored → request submitted → Procurement Lead opens auto-populated plan → edits by instruction → declares COI → Delegate reviews AI summary and approves on mobile → plan locked.", "US-INT-01..05, US-PLN-01..05"),
 ("J2 – Tender to bids (P2, P3, P8)", "Tender pack generated → staged → delegate grants permission to publish → suppliers invited → supplier registers, asks anonymised question → addendum issued → supplier uploads bid before close → portal locks at close.", "US-TND-01..03, US-SUP-01..04"),
 ("J3 – Evaluation to report (P4, P5, P2, P3, P9)", "Evaluators declare COI → independent hidden scoring (technical blind to price) → Chair opens consensus, variance flagged → rationale recorded → report generated → delegate signs off → Probity Advisor reviews read-only.", "US-EVL-01..07"),
 ("J4 – Award to managed contract (P6, P3, P7)", "Legal drafts from template and clause library → reviews deviation register → signing delegate signs (separate authority) → contract locked → contract record and alerts auto-created → expiry Gantt.", "US-CON-01..04, US-CMG-01..04"),
 ("J5 – Oversight and configuration (P9, P10, P11)", "Executive opens dashboard → Probity exports audit trail → Admin edits delegation threshold (no access to bids).", "US-RPT-01..03, US-ADM-01..04"),
 ("J6 – Anonymous to signed-in (all)", "Visitor lands on public page → clicks Get Started → logs in (mock IdP) → redirected by role → uses notifications/profile → logs out.", "US-PLT-01..04"),
]
m += ["| Journey | Steps | Stories |", "|---|---|---|"] + [f"| {a} | {b} | {c} |" for a,b,c in journeys]
m += ["", "## 3. User stories with acceptance criteria", ""]
for mod, name in MODULES.items():
    ss = [s for s in S if s["mod"] == mod]
    if not ss: continue
    m += [f"### {mod} – {name}", ""]
    for s in ss:
        p = next(p for p in PERSONAS if p[0] == s["persona"])
        m += [f"#### {s['id']}  ·  {s['pri']}  ·  Tier {s['tier']}",
              f"**As a** {p[1]}, **I want** {s['want']}, **so that** {s['so']}.", ""]
        for i, (g, w, t) in enumerate(s["gwt"], 1):
            m += [f"- **AC{i}** — **Given** {g}, **when** {w}, **then** {t}."]
        m += [f"- Traces to: {', '.join(cov[s['id']][:8])}{' …(+%d)'%(len(cov[s['id']])-8) if len(cov[s['id']])>8 else ''}", ""]
open(os.path.join(DOCS, "01b-User-Stories.md"), "w", encoding="utf8").write("\n".join(m) + "\n")

res = dict(total=len(rows), noStory=noStory, orphanStories=orph, tiers={f"{a}/{b}": v for (a, b), v in tiers.items()},
           pri={f"{a}/{b}": v for (a, b), v in pri.items()}, stories=len(S), defects=defects,
           gwt=sum(len(s["gwt"]) for s in S))
json.dump(res, open(os.path.join(ROOT, "_work", "coverage.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
