"""M15: updated RTM with actual results -> docs/RTM-Results.csv and the summary printed for docs/M15-Skeleton-Evidence-Report.md.

Result rules (stated in the report, deliberately conservative):
  W  Pass            every user story of the requirement is named in at least one automated test file that passed in the M15 run
     Evidence only   every story is named in a test file or a milestone evidence document, but at least one only in a document
     Not traced      at least one user story is named nowhere in tests or evidence
  S  Stub            tier S: shows 'coming soon' (status from the roadmap register: partly built / coming soon)
  D  Deferred        tier D: not in the proof of concept
This is traceability by reference (the story id appears in a test), not assertion-level proof that every acceptance
criterion of the requirement is checked.
"""

import csv
import glob
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = list(csv.DictReader(open(os.path.join(ROOT, "docs", "RTM.csv"), encoding="utf-8-sig")))


def read_all(patterns):
    text = ""
    for pat in patterns:
        for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
            if "node_modules" in f or os.sep + ".next" in f or os.sep + "dist" in f:
                continue
            text += open(f, encoding="utf-8", errors="ignore").read() + "\n"
    return text


tests = read_all(["e2e/*.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts", "packages/**/*.test.tsx"])
docs = read_all(["docs/M*-Evidence.md"])

roadmap = open(os.path.join(ROOT, "packages", "shared", "src", "roadmap-data.ts"), encoding="utf8").read()
status = {}
for m in re.finditer(r"id: '([^']+)',\s*tier: '(S|D)',\s*status: '(\w+)'", roadmap):
    status[m.group(1)] = m.group(3)


# Enabler stories that tests cover without citing the story id (plan section 3.1 says how each is verified).
# kind "test": the listed files are automated tests that passed in the M15 run. kind "pipeline": verified by the CI
# pipeline definition and its runs, not by a test file.
ENABLER = {
    "US-NFR-01": ("test", ["apps/api/src/audit/audit.test.ts"]),
    "US-NFR-02": ("test", ["apps/api/src/authz/matrix.test.ts", "apps/api/src/authz/abac.test.ts", "apps/api/src/authz/sod.test.ts", "apps/api/src/authz/delegation.test.ts"]),
    "US-NFR-03": ("test", ["apps/api/src/auth/auth.test.ts"]),
    "US-NFR-11": ("test", ["e2e/evidence.spec.ts", "e2e/crawler.spec.ts"]),
    "US-PLT-04": ("test", ["apps/api/src/modules/shell.test.ts", "e2e/shell.spec.ts"]),
    "US-AIA-01": ("test", ["apps/api/src/modules/intake/intake.test.ts", "apps/api/src/modules/plan/plan.test.ts"]),
    "US-AIA-02": ("test", ["apps/api/src/modules/intake/intake.test.ts", "apps/api/src/modules/plan/plan.test.ts"]),
    "US-FUT-01": ("test", ["e2e/crawler.spec.ts", "apps/api/src/roadmap.test.ts"]),
    "US-NFR-07": ("pipeline", [".github/workflows/ci.yml"]),
    "US-NFR-08": ("pipeline", [".github/workflows/ci.yml"]),
}
for _kind, _files in ENABLER.values():
    for _f in _files:
        assert os.path.exists(os.path.join(ROOT, _f)), _f


def mentioned(sid, text):
    return re.search(r"(?<![A-Za-z0-9-])" + re.escape(sid) + r"(?![0-9A-Za-z])", text) is not None


out = []
summary = Counter()
by_story_gap = defaultdict(list)
for r in rows:
    stories = [s.strip() for s in r["User stories"].split(";") if s.strip()]
    tier = r["POC tier"]
    note = ""
    if tier == "W":
        in_tests = [s for s in stories if mentioned(s, tests) or ENABLER.get(s, ("", []))[0] == "test"]
        in_docs = [s for s in stories if s not in in_tests and (mentioned(s, docs) or ENABLER.get(s, ("", []))[0] == "pipeline")]
        missing = [s for s in stories if s not in in_tests and s not in in_docs]
        if not missing and not in_docs:
            result = "Pass"
        elif not missing:
            result, note = "Evidence only", "story named only in a milestone evidence document: " + ", ".join(in_docs)
        else:
            result, note = "Not traced", "story not named in any test or evidence: " + ", ".join(missing)
            for s in missing:
                by_story_gap[s].append(r["Req ID"])
    elif tier == "S":
        result = "Stub - partly built" if status.get(r["Req ID"]) == "PARTIAL" else "Stub - coming soon"
    else:
        result = "Deferred"
    summary[(tier, result)] += 1
    out.append({**r, "Result": result, "Result note": note})

with open(os.path.join(ROOT, "docs", "RTM-Results.csv"), "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)

for k in sorted(summary):
    print(k, summary[k])
print("W total", sum(v for (t, _), v in summary.items() if t == "W"))
print("stories with no test or evidence reference:", dict(by_story_gap))
