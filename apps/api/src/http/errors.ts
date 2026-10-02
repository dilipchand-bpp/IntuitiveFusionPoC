import type { ZodType } from 'zod';

/** Domain/HTTP error that maps 1:1 to an RFC 7807 problem (Technical Specification 4.1). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    title: string,
    public readonly fieldErrors: Array<{ field: string; message: string }> = [],
  ) {
    super(title);
    this.name = 'AppError';
  }
}

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
export const forbidden = (why = 'You do not have permission to do that') =>
  new AppError(403, 'FORBIDDEN', why);

/** Validates untrusted input at the edge; never echoes the offending values back. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new AppError(
    400,
    'VALIDATION_FAILED',
    'Request validation failed',
    r.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
  );
}
