p='README.md'
t=open(p,encoding='utf8',newline='').read()
import re
t=re.sub(r"\*\*Status: Phase 5, milestones M0.M5 complete\*\* \(foundation, design system, data/audit core, identity & access, app shell\)\. Module screens \(M6 onward\) are \"Coming soon\" placeholders\.",
"**Status: Phase 5, milestones M0–M7 complete** (foundation, design system, data/audit core, identity & access, app shell, request intake, procurement plan). Later modules (tender and supplier portal, evaluation, contracts, reporting, admin) are \"Coming soon\" placeholders. Voice dictation (speech to text) works in Chrome and Edge in the request chat and the plan instruction box.",t)
t=t.replace("Open http://localhost:3000. The environment needs `SESSION_SECRET` (32+ characters) – copy `.env.example` to `.env` and set it.",
"Open http://localhost:3000. `npm run dev` creates `.env` with a random `SESSION_SECRET` if there is none. If sign-in fails, check that both `:3000` and `:4000` are listening – if the API died, stop the dev terminal and run `npm run dev` again.")
t=t.replace("PW_CHANNEL=msedge npm run e2e    # browser tests (uses the installed Edge; CI uses Playwright Chromium)",
"PW_CHANNEL=msedge npm run e2e    # browser tests on a production build, ports 3100/4100 (so they never clash with `npm run dev` on 3000/4000); uses the installed Edge, CI uses Playwright Chromium")
open(p,'w',encoding='utf8',newline='').write(t)
