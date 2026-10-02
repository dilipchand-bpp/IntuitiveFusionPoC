import { DevicePreview, type Device } from '@/components/preview/device-preview';
import { safePath } from '@/components/preview/safe-path';

export const metadata = { title: 'Device preview – Intuitive Fusion' };

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; device?: string }>;
}) {
  const { path, device } = await searchParams;
  const d: Device = device === 'tablet' || device === 'desktop' ? device : 'phone';
  return (
    <main id="main">
      <h1 className="sr-only">Device preview</h1>
      <DevicePreview initialPath={safePath(path)} initialDevice={d} />
    </main>
  );
}
