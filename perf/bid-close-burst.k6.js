// k6 bid-close burst (DRAFT - not run: k6 is not installed on the build machine).
// Intent: many suppliers submit in the last minute before the closing time; every accepted bid must have a receipt and
// every request after the closing instant must be refused with 409 BID_CLOSED (never accepted, never a 5xx).
//
//   k6 run -e API=http://localhost:4000 -e TENDER=<tender id> -e SECONDS=60 perf/bid-close-burst.k6.js
//
// Needs N pre-registered supplier users (SUPPLIERS = comma separated emails) sharing SUPPLIER_PASSWORD, each already
// holding one technical and one commercial file. Run against a staging stack, never production.
/* global __ENV, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const accepted = new Counter('bids_accepted');
const refusedClosed = new Counter('bids_refused_closed');
const unexpected = new Counter('bids_unexpected');

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: `${__ENV.SECONDS || 60}s`,
      preAllocatedVUs: 100,
    },
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
    const res = http.post(
      `${API}/api/v1/auth/login`,
      JSON.stringify({ email, password: __ENV.SUPPLIER_PASSWORD }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
    return { email, csrf: res.json('csrfToken'), cookie: res.cookies['if_supplier_session'][0].value };
  });
}

export default function (sessions) {
  const s = sessions[__ITER % sessions.length];
  const res = http.post(`${API}/api/v1/supplier/tenders/${__ENV.TENDER}/submission`, null, {
    headers: { 'x-csrf-token': s.csrf, cookie: `if_supplier_session=${s.cookie}` },
  });
  const ok = check(res, {
    'accepted, refused as closed, or already submitted': (r) => [201, 409].includes(r.status),
  });
  if (res.status === 201) accepted.add(1);
  else if (res.status === 409 && res.json('code') === 'BID_CLOSED') refusedClosed.add(1);
  else if (res.status !== 409 || !ok) unexpected.add(1);
  sleep(0.1);
}
