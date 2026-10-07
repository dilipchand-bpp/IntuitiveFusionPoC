import { TopologyPanel } from '@/components/b11/topology';

export const metadata = { title: 'Hosting topology – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Hosting topology</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Platform-hosted, customer cloud or hybrid: what flows where, who is responsible for what, and what
          it means for residency and keys. DESIGN ONLY: not built.
        </p>
      </header>
      <TopologyPanel />
    </div>
  );
}
