import { ActionList } from '@/components/b9/action-list';

export const metadata = { title: 'Waiting for you – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Waiting for you</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          What needs your attention now, for the roles you hold. Select an item to go to where it is dealt
          with.
        </p>
      </header>
      <ActionList />
    </div>
  );
}
