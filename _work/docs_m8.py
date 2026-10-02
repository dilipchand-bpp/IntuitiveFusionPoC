import os

root = r'C:\TPM-Workspace\06-Code\IntuitiveFusionPOC'

# ---------------------------------------------------------------- swap points
p = os.path.join(root, 'docs', 'swap-points.md')
t = open(p, encoding='utf8', newline='').read()
a = t.index('## Still mocked, adapter arrives in a later milestone')
new_sections = '''## Bid file storage and virus scan (M8)

| | |
|---|---|
| Storage | `SealedStore` in `modules/tender/files.ts`: AES-256-GCM, key derived (HKDF) from the server secret, objects under `STORAGE_DIR/<tenant>/<submission>/<uuid>`. Stands in for S3 + KMS (SSE-KMS, per-tenant key) |
| Virus scan | `scanBytes()` stub: flags only the standard EICAR test string. A real adapter calls an AV service (for example an S3 object-scan Lambda) and keeps the same `CLEAN` / `INFECTED` result |
| Upload checks (kept in production) | allow-list of extensions, 10 MB cap, content ("magic byte") check, double-extension and path-trick refusal, 20 files per bid |
| Database seal | Row level security on `file_object` (migration 0003): the owning supplier, and after close only the evaluating roles, can read; administrators never |

**Real adapter notes:** upload by pre-signed URL straight to the bucket rather than through the API, then scan before the file is marked `CLEAN`; keep the receipt checksum (`sha256`) so a bid can be proved unchanged.

## Supplier registration, invitation e-mail and ABN (M8)

| | |
|---|---|
| Invitation e-mail | Simulated. The one-time registration link is returned once to the buyer who created it (only its SHA-256 is stored) and an `invitation.queued` audit event is written at publish. A real `EmailService` sends the link instead |
| ABN | Checked with the official 11-digit checksum only (`validAbn`). A real adapter would also look the number up in the ABN Lookup service |
| Sanctions / insurance | Registered suppliers start with `sanctionsStatus = PENDING`; no screening provider is called yet |
| Existing company | An ABN already in the directory cannot be joined by self-registration (it would expose that company's tenders). The buyer adds extra contacts after checking them (flow not built yet) |

'''
t = t[:a] + new_sections + t[a:]
t = t.replace('| Document storage | `DocumentStore` | M8 |\n', '')
open(p, 'w', encoding='utf8', newline='').write(t)

# ---------------------------------------------------------------- k6 script (drafted, not run)
os.makedirs(os.path.join(root, 'perf'), exist_ok=True)
k6 = """// k6 bid-close burst (DRAFT - not run: k6 is not installed on the build machine).
// Intent: many suppliers submit in the last minute before the closing time; every accepted bid must have a receipt and
// every request after the closing instant must be refused with 409 BID_CLOSED (never accepted, never a 5xx).
//
//   k6 run -e API=http://localhost:4000 -e TENDER=<tender id> -e SECONDS=60 perf/bid-close-burst.k6.js
//
// Needs N pre-registered supplier users (SUPPLIERS = comma separated emails) sharing SUPPLIER_PASSWORD, each already
// holding one technical and one commercial file. Run against a staging stack, never production.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const accepted = new Counter('bids_accepted');
const refusedClosed = new Counter('bids_refused_closed');
const unexpected = new Counter('bids_unexpected');

export const options = {
  scenarios: {
    burst: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: `${__ENV.SECONDS || 60}s`, preAllocatedVUs: 100 },
  },
  thresholds: {
    bids_unexpected: ['count==0'],
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.001'],
  },
};

const API = __ENV.API || 'http://localhost:4000';
const emails = (__ENV.SUPPLIERS || '').split(',').filter(Boolean);

export function setup() {
  return emails.map((email) => {
    const res = http.post(`${API}/api/v1/auth/login`, JSON.stringify({ email, password: __ENV.SUPPLIER_PASSWORD }), {
      headers: { 'content-type': 'application/json' },
    });
    return { email, csrf: res.json('csrfToken'), cookie: res.cookies['if_supplier_session'][0].value };
  });
}

export default function (sessions) {
  const s = sessions[__ITER % sessions.length];
  const res = http.post(`${API}/api/v1/supplier/tenders/${__ENV.TENDER}/submission`, null, {
    headers: { 'x-csrf-token': s.csrf, cookie: `if_supplier_session=${s.cookie}` },
  });
  const ok = check(res, { 'accepted, refused as closed, or already submitted': (r) => [201, 409].includes(r.status) });
  if (res.status === 201) accepted.add(1);
  else if (res.status === 409 && res.json('code') === 'BID_CLOSED') refusedClosed.add(1);
  else if (res.status !== 409 || !ok) unexpected.add(1);
  sleep(0.1);
}
"""
open(os.path.join(root, 'perf', 'bid-close-burst.k6.js'), 'w', encoding='utf8', newline='').write(k6)
print('ok')
