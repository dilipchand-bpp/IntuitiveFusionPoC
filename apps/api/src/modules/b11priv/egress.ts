/**
 * SEC-D05: no data to public AI endpoints. The egress policy.
 *
 * Every call from this application to anything beyond itself (an AI model, outside search, a connector, the legal
 * webhook, e-signature, the messaging gateway, the repository) must pass `assertEgress` / `checkOutbound` first. The
 * allowed destinations are the `egress.allowedHosts` setting; the default holds only `*.simulated.test`, which never
 * resolves on the public internet. A host that is not on the list is refused with EGRESS_BLOCKED and the attempt is
 * audited and counted (see outbound.ts).
 *
 * This file is the ONLY place in apps/api/src allowed to make a network call. In this proof of concept it makes none:
 * every provider is simulated and in-process. A static test (egress.test.ts) scans the source tree for fetch, http,
 * https, net and similar and fails on any use outside the documented allow-list of files, so a future developer
 * cannot add a public call silently.
 *
 * SWAP POINT (docs/swap-points.md): in production this policy is also enforced by the network: a private subnet with
 * no internet gateway, VPC endpoints to the approved services and an egress proxy or firewall that carries the same
 * allow-list. The application-level check stays as the second line.
 */
import { AppError } from '../../http/errors.js';

export const EGRESS_MODEL = 'egress-simulated-v1';

/** A refused outbound transfer. It carries `refusal` so a route can commit the audit record and then answer 422. */
export class OutboundRefusal extends AppError {
  readonly refusal = true as const;
  constructor(
    code: 'RESIDENCY_VIOLATION' | 'EGRESS_BLOCKED',
    title: string,
    readonly detail: { kind: 'RESIDENCY' | 'EGRESS'; purpose: string; target: string; region: string | null },
  ) {
    super(422, code, title);
  }
}

export const normaliseHost = (h: string): string =>
  h
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/:?#].*$/, '');

/** A literal address is never on the list unless it is written out exactly; wildcards cover names only. */
const PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Why a pattern may not be added to the allow-list, or null when it is fine. */
export function patternProblem(raw: string): string | null {
  const pattern = raw.trim().toLowerCase();
  if (/^\*\.[a-z0-9-]+$/.test(pattern))
    return `"${raw}" is too broad: a wildcard needs at least two labels after the star (for example *.simulated.test)`;
  if (!PATTERN.test(pattern)) return `"${raw}" is not a host name or a *.wildcard.name`;
  if (/^\d+(\.\d+){3}$/.test(pattern)) return `"${raw}" is an address; list a host name`;
  return null;
}

export function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = normaliseHost(host);
  if (!h) return false;
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

export interface EgressDecision {
  allowed: boolean;
  host: string;
  matchedBy: string | null;
}

export function egressDecision(allowedHosts: readonly string[], host: string): EgressDecision {
  const h = normaliseHost(host);
  const hit = allowedHosts.find((p) => hostMatches(p, h));
  return { allowed: Boolean(hit), host: h, matchedBy: hit ?? null };
}

/** Throws EGRESS_BLOCKED unless the host is on the list. The pure form: no database, no audit (see outbound.ts for those). */
export function assertEgress(allowedHosts: readonly string[], host: string, purpose = 'outbound call'): void {
  const d = egressDecision(allowedHosts, host);
  if (!d.allowed)
    throw new OutboundRefusal(
      'EGRESS_BLOCKED',
      `Outbound call refused (${purpose} to ${d.host || 'an unknown host'}): the host is not on the egress allow-list`,
      { kind: 'EGRESS', purpose, target: d.host, region: null },
    );
}

/** The evidence text shown on the residency and egress page (SEC-D05). */
export const EGRESS_EVIDENCE =
  'Every outbound call (AI model, outside search, connector, legal webhook, e-signature, messaging gateway, repository) is checked ' +
  'against this allow-list before it is made. A host that is not listed is refused, audited and counted below. The default list holds only ' +
  'simulated hosts (*.simulated.test); no public AI endpoint is reachable. A test scans the source for any other network call and fails the build if one appears.';
