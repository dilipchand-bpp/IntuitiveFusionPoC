/**
 * The tool adapter (design principle 1): the agent calls the application's own routes through app.inject with a session of the
 * person who started the run. The role guards, segregation of duties, probity rules, visibility rules and audit therefore apply
 * unchanged, and the agent can never do what that person cannot. Every change (anything but a GET) is also audited with the
 * actor label "Procurement Copilot", and every call carries a correlation id that names the run and the step.
 */
import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '../../db/client.js';
import type { Role } from '../../db/schema.js';
import { COOKIE_NAMES } from '../../auth/session-service.js';
import type { GuardDeps } from '../../auth/guard.js';
import { AGENT_BY_KEY, type AgentKey } from './agents.js';

export const ACTOR_LABEL = 'Procurement Copilot';
export const ENGINE = 'rules-simulated-v1';

export interface ToolResult {
  status: number;
  ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  code: string | undefined;
  title: string | undefined;
  errors: Array<{ field: string; message: string }>;
  /** The route belongs to another module that may not be built yet (404 from the router, or 501): not a failure. */
  notAvailable: boolean;
  /** The guard or the rules of the application refused this person. */
  forbidden: boolean;
  ms: number;
}

export interface Actor {
  tenantId: string;
  userId: string;
  role: string;
  runId: string;
}

export class ToolClient {
  private session: { id: string; cookies: Record<string, string>; csrf: string } | null = null;
  constructor(
    private readonly app: FastifyInstance,
    private readonly d: GuardDeps,
    private readonly actor: Actor,
    private readonly asSupplier = false,
  ) {}

  private async ensureSession() {
    if (this.session) return this.session;
    const s = await this.d.sessions.createFor(this.actor.userId, { userAgent: 'procurement-copilot' });
    if (!s) throw new Error('The person who started this run can no longer sign in');
    const pool = this.asSupplier ? 'SUPPLIER' : 'STAFF';
    this.session = { id: s.id, cookies: { [COOKIE_NAMES[pool]]: s.cookieValue }, csrf: s.csrf };
    return this.session;
  }

  /** Ends the short-lived session made for this tick. */
  async close() {
    if (this.session) await this.d.sessions.revoke(this.session.id).catch(() => undefined);
    this.session = null;
  }

  /**
   * Calls one tool. `agent` must own the tool (CP-06: each specialist has its own tools); a call outside the list is a programming
   * error and is refused before anything is sent.
   */
  async call(
    agent: AgentKey,
    tool: string,
    opts: {
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
      stepKey: string;
    },
  ): Promise<ToolResult> {
    const def = AGENT_BY_KEY.get(agent)?.tools.find((t) => t.name === tool);
    if (!def || def.method === 'LOCAL') throw new Error(`Agent ${agent} has no tool ${tool}`);
    let path = def.path;
    for (const [k, v] of Object.entries(opts.params ?? {}))
      path = path.replace(`:${k}`, encodeURIComponent(v));
    if (path.includes('/:')) throw new Error(`Tool ${tool}: path parameter missing`);
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    return this.raw(def.method, path + qs, opts.body, {
      stepKey: opts.stepKey,
      agent,
      optional: def.optionalCapability === true,
    });
  }

  async raw(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
    meta: { stepKey: string; agent: string; optional?: boolean },
  ): Promise<ToolResult> {
    const sess = await this.ensureSession();
    const started = Date.now();
    const res = await this.app.inject({
      method,
      url: `/api/v1${path}`,
      cookies: sess.cookies,
      headers: {
        ...(method === 'GET' ? {} : { 'x-csrf-token': sess.csrf }),
        'x-correlation-id': `copilot:${this.actor.runId}:${meta.stepKey}`.slice(0, 120),
        'user-agent': 'procurement-copilot',
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const ms = Date.now() - started;
    let json: unknown;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = null;
    }
    const j = (json ?? {}) as {
      code?: string;
      title?: string;
      errors?: Array<{ field: string; message: string }>;
    };
    const routerMissing = res.statusCode === 404 && j.code === 'NOT_FOUND' && j.title === 'Not found';
    const result: ToolResult = {
      status: res.statusCode,
      ok: res.statusCode >= 200 && res.statusCode < 300,
      json,
      code: j.code,
      title: j.title,
      errors: Array.isArray(j.errors) ? j.errors : [],
      notAvailable: meta.optional === true && (routerMissing || res.statusCode === 501),
      forbidden: res.statusCode === 403,
      ms,
    };
    if (method !== 'GET') await this.audit(method, path, meta, result);
    return result;
  }

  private async audit(method: string, path: string, meta: { stepKey: string; agent: string }, r: ToolResult) {
    const ctx: RequestContext = {
      tenantId: this.actor.tenantId,
      userId: this.actor.userId,
      role: this.actor.role as Role,
      correlationId: `copilot:${this.actor.runId}:${meta.stepKey}`.slice(0, 120),
    };
    // the path keeps its ids (they are not secrets); bodies are never copied into the audit trail here
    await this.d.audit
      .recordOutsideTx(this.d.database, ctx, {
        action: 'copilot.tool_call',
        entityType: 'cp_run',
        entityId: this.actor.runId,
        after: {
          actorLabel: this.asSupplier ? `${ACTOR_LABEL} (SIMULATED supplier response)` : ACTOR_LABEL,
          simulated: this.asSupplier,
          engine: ENGINE,
          agent: meta.agent,
          method,
          path: path.split('?')[0],
          status: r.status,
          code: r.code ?? null,
          stepKey: meta.stepKey,
        },
        result: r.ok ? 'SUCCESS' : r.forbidden ? 'DENIED' : 'FAILED',
      })
      .catch(() => undefined);
  }
}
