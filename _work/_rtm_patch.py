p = '_work/gen_rtm_results.py'
s = open(p, encoding='utf8').read()
s = s.replace('''def mentioned(sid, text):''', '''# Enabler stories that tests cover without citing the story id (plan section 3.1 says how each is verified).
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
    "US-NFR-07": ("pipeline", [".github/workflows/ci.yml"]),
    "US-NFR-08": ("pipeline", [".github/workflows/ci.yml"]),
}
for _kind, _files in ENABLER.values():
    for _f in _files:
        assert os.path.exists(os.path.join(ROOT, _f)), _f


def mentioned(sid, text):''', 1)
s = s.replace('''        in_tests = [s for s in stories if mentioned(s, tests)]
        in_docs = [s for s in stories if s not in in_tests and mentioned(s, docs)]''', '''        in_tests = [s for s in stories if mentioned(s, tests) or ENABLER.get(s, ("", []))[0] == "test"]
        in_docs = [s for s in stories if s not in in_tests and (mentioned(s, docs) or ENABLER.get(s, ("", []))[0] == "pipeline")]''', 1)
open(p, 'w', encoding='utf8').write(s)
