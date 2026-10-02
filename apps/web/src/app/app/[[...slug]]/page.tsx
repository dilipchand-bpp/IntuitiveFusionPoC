import { ModulePage } from '../../module-page';

type Params = { slug?: string[] };

// TODO(M6-M12): each module replaces its entry with a real page; unknown paths stay 404.
export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug = [] } = await params;
  return <ModulePage pathname={['/app', ...slug].join('/')} />;
}
