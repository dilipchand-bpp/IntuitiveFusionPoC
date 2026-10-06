// Gives the four demo suppliers a location in the running dev API (same values as the seed), so a reseed is not needed.
const base = process.env.API ?? 'http://localhost:4000/api/v1';
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'procurement@meridian-demo.example', password: 'Demo-Only-Passw0rd!2026' }),
});
if (!login.ok) throw new Error(`login ${login.status} ${await login.text()}`);
const csrf = (await login.json()).csrfToken;
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const list = await (await fetch(`${base}/suppliers`, { headers: { cookie } })).json();
const rows = Array.isArray(list) ? list : (list.items ?? []);
const where = {
  'Brightwave': ['Sydney', 'NSW', -33.87, 151.21],
  'Evergreen': ['Newcastle', 'NSW', -32.93, 151.78],
  'Northstar': ['Brisbane', 'QLD', -27.47, 153.03],
  'Summit': ['Perth', 'WA', -31.95, 115.86],
};
for (const s of rows) {
  const k = Object.keys(where).find((n) => (s.company ?? '').startsWith(n));
  if (!k) continue;
  const [city, state, lat, lng] = where[k];
  const r = await fetch(`${base}/suppliers/${s.id}/location`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: JSON.stringify({ city, state, country: 'Australia', lat, lng }),
  });
  console.log(s.company, r.status);
}
