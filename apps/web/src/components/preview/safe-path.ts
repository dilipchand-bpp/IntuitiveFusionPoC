/** Only same-site paths may be framed, and never the preview itself (no mirrors of mirrors). */
export function safePath(p: string | undefined): string {
  const odd = (c: string) => c.charCodeAt(0) < 32 || c === '\\'; // control characters and backslashes
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/preview') || [...p].some(odd))
    return '/';
  return p;
}
