import { SignedInPlaceholder } from '../../signed-in-placeholder';

// TODO(M5+): real Supplier portal pages. Catch-all so every path under /supplier resolves (never a 404 for a permitted role).
export default function Page() {
  return <SignedInPlaceholder area="Supplier portal" />;
}
