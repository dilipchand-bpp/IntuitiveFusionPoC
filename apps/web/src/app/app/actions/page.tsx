import { PageHeader } from '@if/ui';
import { ActionList } from '@/components/b9/action-list';

export const metadata = { title: 'Waiting for you – Intuitive Fusion' };

export default function Page() {
  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        title="Waiting for you"
        subtitle="What needs your attention now, for the roles you hold. Select an item to go to where it is dealt with."
      />
      <ActionList />
    </div>
  );
}
