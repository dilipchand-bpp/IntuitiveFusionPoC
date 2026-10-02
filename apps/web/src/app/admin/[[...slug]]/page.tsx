import { SignedInPlaceholder } from '../../signed-in-placeholder';

// TODO(M5+): real Administration pages. Catch-all so every path under /admin resolves (never a 404 for a permitted role).
export default function Page() {
  return <SignedInPlaceholder area="Administration" />;
}
