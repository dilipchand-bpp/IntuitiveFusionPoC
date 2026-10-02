import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withContext, type Tx } from '../db/client.js';
import * as s from '../db/schema.js';
import { TENANT_ID, uid } from '../db/seed.js';
import { sharedSeededDb } from '../test-helpers.js';
import { checkDelegation } from './delegation.js';

const actor = (key: string, roles: string[]) => ({ tenantId: TENANT_ID, userId: uid(`user:${key}`), roles });
const admin = { tenantId: TENANT_ID, userId: uid('user:admin'), role: 'ADMIN' as const };
const run = async <T>(fn: (tx: Tx) => Promise<T>) => {
  const db = await sharedSeededDb();
  return withContext(db, { tenantId: TENANT_ID, userId: uid('user:delegate'), role: 'DELEGATE' }, fn);
};

describe('delegation of authority engine', () => {
  it('allows sourcing approval at or under the limit and refuses above it with the limit reported', async () => {
    const ok = await run((tx) =>
      checkDelegation(tx, actor('delegate', ['DELEGATE']), 'SOURCING_APPROVAL', 250_000),
    );
    expect(ok).toMatchObject({ allowed: true, limit: 250_000 });
    const over = await run((tx) =>
      checkDelegation(tx, actor('delegate', ['DELEGATE']), 'SOURCING_APPROVAL', 250_000.01),
    );
    expect(over).toMatchObject({ allowed: false, code: 'DELEGATION_EXCEEDED', limit: 250_000 });
  });
  it('the executive has the higher sourcing limit (high-value plans have an approver)', async () => {
    const r = await run((tx) => checkDelegation(tx, actor('exec', ['EXEC']), 'SOURCING_APPROVAL', 4_800_000));
    expect(r).toMatchObject({ allowed: true, limit: 10_000_000 });
  });
  it('signing authority is a separate grant: exec can approve sourcing but has no signing delegation', async () => {
    const r = await run((tx) => checkDelegation(tx, actor('exec', ['EXEC']), 'CONTRACT_SIGNING', 100));
    expect(r).toMatchObject({ allowed: false, code: 'SIGNING_AUTHORITY_INSUFFICIENT', limit: null });
  });
  it('the delegate holds signing authority up to its own limit', async () => {
    const ok = await run((tx) =>
      checkDelegation(tx, actor('delegate', ['DELEGATE']), 'CONTRACT_SIGNING', 4_999_999),
    );
    expect(ok.allowed).toBe(true);
    const no = await run((tx) =>
      checkDelegation(tx, actor('delegate', ['DELEGATE']), 'CONTRACT_SIGNING', 5_000_001),
    );
    expect(no).toMatchObject({ allowed: false, code: 'SIGNING_AUTHORITY_INSUFFICIENT', limit: 5_000_000 });
  });
  it('users without any delegation are refused', async () => {
    const r = await run((tx) =>
      checkDelegation(tx, actor('requester', ['REQUESTER']), 'SOURCING_APPROVAL', 1),
    );
    expect(r).toMatchObject({ allowed: false, code: 'NO_DELEGATION' });
  });
  it('an admin change to the threshold takes effect immediately and inactive delegations are ignored', async () => {
    const db = await sharedSeededDb();
    const id = uid('delegation:SOURCING_APPROVAL');
    await withContext(db, admin, (tx) =>
      tx.update(s.delegation).set({ maxValue: '1000000.00' }).where(eq(s.delegation.id, id)),
    );
    expect(
      await run((tx) => checkDelegation(tx, actor('delegate', ['DELEGATE']), 'SOURCING_APPROVAL', 900_000)),
    ).toMatchObject({ allowed: true });
    await withContext(db, admin, (tx) =>
      tx.update(s.delegation).set({ active: false }).where(eq(s.delegation.id, id)),
    );
    expect(
      await run((tx) => checkDelegation(tx, actor('delegate', ['DELEGATE']), 'SOURCING_APPROVAL', 1)),
    ).toMatchObject({
      allowed: false,
      code: 'NO_DELEGATION',
    });
    // restore the shared fixture for other tests
    await withContext(db, admin, (tx) =>
      tx.update(s.delegation).set({ maxValue: '250000.00', active: true }).where(eq(s.delegation.id, id)),
    );
  });
  it('division-restricted delegations only apply to that division', async () => {
    const db = await sharedSeededDb();
    const id = uid('delegation:division-test');
    await withContext(db, admin, (tx) =>
      tx.insert(s.delegation).values({
        id,
        tenantId: TENANT_ID,
        scope: 'PUBLISH_PERMISSION',
        role: 'FINANCE',
        userId: uid('user:finance'),
        maxValue: '10.00',
        division: 'Finance',
      }),
    );
    const f = actor('finance', ['FINANCE']);
    expect((await run((tx) => checkDelegation(tx, f, 'PUBLISH_PERMISSION', 5, 'Finance'))).allowed).toBe(
      true,
    );
    expect((await run((tx) => checkDelegation(tx, f, 'PUBLISH_PERMISSION', 5, 'IT'))).allowed).toBe(false);
    await withContext(db, admin, (tx) => tx.delete(s.delegation).where(eq(s.delegation.id, id)));
  });
});
