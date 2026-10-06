import { EsignCeremony } from '@/components/b10/public-links';

export const metadata = { title: 'Sign – Intuitive Fusion', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EsignCeremony token={token} />;
}
