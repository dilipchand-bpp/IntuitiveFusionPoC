import { SignedInPlaceholder } from '../../signed-in-placeholder';

// TODO(M5+): real Staff area pages. Catch-all so every path under /app resolves (never a 404 for a permitted role).
export default function Page() {
  return <SignedInPlaceholder area="Staff area" />;
}
