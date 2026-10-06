import { CounselPortal } from '@/components/b8/public-pages';

export const metadata = { title: 'Contract review – Intuitive Fusion', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CounselPortal token={token} />;
}
