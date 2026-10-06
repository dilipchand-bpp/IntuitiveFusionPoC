import { RespondLink } from '@/components/b10/public-links';

export const metadata = { title: 'Are you safe? – Intuitive Fusion', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RespondLink token={token} />;
}
