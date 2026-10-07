/** The envelope-encryption vault the sealed file store delegates to (SEC-D04). See keys.ts for the design. */
import type { Clock } from '@if/shared';
import { withSystem, type Database, type Tx } from '../../db/client.js';
import type { BlobVault } from '../tender/files.js';
import { openBlob, sealBlob } from './keys.js';

export class KeyVault implements BlobVault {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}
  /** Inside a caller's transaction the work joins it; outside one it runs in its own system transaction. */
  private run<T>(tx: Tx | undefined, fn: (t: Tx) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : withSystem(this.database, fn);
  }
  seal(
    tx: Tx | undefined,
    tenantId: string,
    purpose: 'DATA' | 'BIDS' | 'PROJECT',
    bytes: Buffer,
    context: string,
  ): Promise<Buffer> {
    return this.run(tx, (t) => sealBlob(t, tenantId, purpose, bytes, { context, now: this.clock.now() }));
  }
  open(tx: Tx | undefined, tenantId: string, blob: Buffer, context: string): Promise<Buffer> {
    return this.run(tx, (t) => openBlob(t, tenantId, blob, context));
  }
}
