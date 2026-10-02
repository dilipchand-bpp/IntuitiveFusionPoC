// Spike B: append-only audit table with sha256 hash chain written in same tx as a business change. Throughput + tamper detection + grants.
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const db = new PGlite();
await db.exec(`
 create table plan_field(id serial primary key, k text, v text);
 create table audit_event(seq bigserial primary key, at timestamptz default now(), actor int, action text, entity text, before jsonb, after jsonb, prev_hash text not null, hash text not null);
 create role app_user nologin;
 grant select, insert, update on plan_field to app_user; grant usage on all sequences in schema public to app_user;
 grant select, insert on audit_event to app_user;`);
const h = (prev, row) => createHash('sha256').update(prev + JSON.stringify(row)).digest('hex');
let last = 'GENESIS';
async function write(i) {
  await db.transaction(async tx => {
    const before = { v: 'a' + i }, after = { v: 'b' + i };
    await tx.query('insert into plan_field(k,v) values ($1,$2)', ['f' + i, after.v]);
    const row = { actor: 1, action: 'plan.update', entity: 'plan_field:' + i, before, after };
    const hash = h(last, row);
    await tx.query('insert into audit_event(actor,action,entity,before,after,prev_hash,hash) values ($1,$2,$3,$4,$5,$6,$7)', [1, row.action, row.entity, before, after, last, hash]);
    last = hash;
  });
}
const N = 2000; const t0 = performance.now(); for (let i = 0; i < N; i++) await write(i); const dt = performance.now() - t0;
const tps = N / (dt / 1000); console.log(`wrote ${N} business changes + audit events in ${dt.toFixed(0)} ms = ${tps.toFixed(0)} tx/s (single writer, in-memory PGlite)`);
async function verify() {
  const r = await db.query('select seq,actor,action,entity,before,after,prev_hash,hash from audit_event order by seq'); let prev = 'GENESIS';
  for (const x of r.rows) { const calc = h(prev, { actor: x.actor, action: x.action, entity: x.entity, before: x.before, after: x.after }); if (x.prev_hash !== prev || x.hash !== calc) return x.seq; prev = x.hash; } return null;
}
const out = [];
const check = (n, ok) => { out.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n); };
const v0 = performance.now(); check('hash chain verifies when untouched', (await verify()) === null); console.log(`verify ${N} events: ${(performance.now() - v0).toFixed(0)} ms`);
await db.exec(`update audit_event set after='{"v":"HACKED"}' where seq=1000`);
check('tamper of seq 1000 detected at exactly 1000 (superuser edit)', (await verify()) === 1000);
await db.exec('set role app_user');
for (const [sql, name] of [["update audit_event set actor=2 where seq=1", 'app role cannot UPDATE audit'], ["delete from audit_event where seq=1", 'app role cannot DELETE audit']]) {
  let denied = false; try { await db.exec(sql); } catch { denied = true; } check(name, denied);
}
let rolled = false; try { await db.transaction(async tx => { await tx.query("insert into plan_field(k,v) values ('x','y')"); throw new Error('audit failed'); }); } catch { rolled = true; }
const c = await db.query("select count(*)::int c from plan_field where k='x'"); check('business change rolled back when audit step fails (fail closed)', rolled && c.rows[0].c === 0);
console.log(JSON.stringify({ spike: 'B', txPerSec: Math.round(tps), checks: out.filter(Boolean).length + '/' + out.length }));
