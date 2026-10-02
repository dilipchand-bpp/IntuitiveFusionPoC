// Spike A: can Postgres RLS enforce "evaluator sees only own scores" and what does it cost vs a service-layer WHERE?
import { PGlite } from '@electric-sql/pglite';
import { performance } from 'node:perf_hooks';
const db = new PGlite();
await db.exec(`
 create table score(id serial primary key, evaluator_id int not null, supplier_id int, criterion_id int, score numeric, phase text default 'SCORING');
 create role app_user nologin; grant select, insert on score to app_user; grant usage on sequence score_id_seq to app_user;
 alter table score enable row level security; alter table score force row level security;
 create policy own_scores on score for select to app_user
   using (evaluator_id = current_setting('app.user_id')::int
          or (current_setting('app.role') in ('CHAIR','PROBITY') and current_setting('app.consensus_open') = 'true'));
 create policy ins on score for insert to app_user with check (evaluator_id = current_setting('app.user_id')::int);
`);
const N = 20000;
await db.exec(`insert into score(evaluator_id,supplier_id,criterion_id,score) select (g%5)+1,(g%5)+1,(g%12)+1,(g%10) from generate_series(1,${N}) g;`);
const ctx = async (uid, role, open) => { await db.exec(`set role app_user; select set_config('app.user_id','${uid}',false), set_config('app.role','${role}',false), set_config('app.consensus_open','${open}',false);`); };
const res = [];
const check = (name, ok) => { res.push([name, ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name); };
await ctx(1, 'EVALUATOR', false);
let r = await db.query('select count(*)::int c, count(distinct evaluator_id)::int e from score');
check('evaluator 1 sees only own rows (distinct evaluators = 1)', r.rows[0].e === 1);
r = await db.query('select count(*)::int c from score where evaluator_id = 2');
check('evaluator 1 cannot read evaluator 2 even when asking explicitly', r.rows[0].c === 0);
let blocked = false; try { await db.exec(`insert into score(evaluator_id,supplier_id,criterion_id,score) values (2,1,1,9)`); } catch { blocked = true; }
check('evaluator 1 cannot insert a score as evaluator 2', blocked);
await db.exec('reset role'); await ctx(9, 'CHAIR', false);
r = await db.query('select count(*)::int c from score'); check('chair sees nothing before consensus opens', r.rows[0].c === 0);
await db.exec('reset role'); await ctx(9, 'CHAIR', true);
r = await db.query('select count(*)::int c from score'); check('chair sees all after consensus opens', r.rows[0].c === N);
await db.exec('reset role'); await ctx(1, 'EVALUATOR', false);
// forgetting the WHERE is the classic bug the service layer cannot protect against:
const T = 200;
let t0 = performance.now(); for (let i = 0; i < T; i++) await db.query('select * from score where supplier_id = $1', [1]); const rls = (performance.now() - t0) / T;
await db.exec('reset role');
t0 = performance.now(); for (let i = 0; i < T; i++) await db.query('select * from score where supplier_id = $1 and evaluator_id = 1', [1]); const svc = (performance.now() - t0) / T;
console.log(`latency per query over ${N} rows: RLS ${rls.toFixed(2)} ms vs explicit WHERE ${svc.toFixed(2)} ms`);
console.log(JSON.stringify({ spike: 'A', passed: res.filter(x => x[1]).length, total: res.length, rlsMs: +rls.toFixed(2), serviceMs: +svc.toFixed(2) }));
