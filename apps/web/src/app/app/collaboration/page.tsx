import { LayoutDesigner, type LayoutViewData } from '@/components/collab/layout-designer';
import { ReferenceContent } from '@/components/collab/ai-panels';
import { apiGet, getSessionUser } from '@/lib/session';

export const metadata = { title: 'Collaboration – Intuitive Fusion' };

const TOOLS = [
  [
    'Document tools',
    'Open a procurement plan or a tender: who else is in it, tracked changes, saved versions, comparison and a digest of what changed since you last looked appear on the page.',
  ],
  [
    'Risk assessment',
    'Open a request to draft a risk assessment: candidate risks, your decisions and ratings, and treatments to choose from.',
  ],
  [
    'Plain-language instructions',
    'Move a procurement to the next phase, change a tender template, or add and remove evaluation committee members by typing what you want.',
  ],
  [
    'Summary of responses',
    'After a tender closes, procurement and the panel see each response summarised: pricing, dates, proposed changes, pros and cons.',
  ],
];

export default async function CollaborationPage() {
  const user = await getSessionUser();
  const canDesign = user?.roles.some((r) => r === 'ADMIN' || r === 'PROCUREMENT') ?? false;
  const canRead =
    user?.roles.some((r) => ['ADMIN', 'PROCUREMENT', 'LEGAL', 'DELEGATE', 'EXEC'].includes(r)) ?? false;
  const layouts = canRead ? await apiGet<LayoutViewData[]>('/layouts') : null;
  const canContent =
    user?.roles.some((r) => ['ADMIN', 'PROCUREMENT', 'LEGAL', 'REQUESTER'].includes(r)) ?? false;
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Collaboration</h1>
        <p className="mt-1 max-w-prose text-text-muted">
          Work on documents together, design how they are laid out, and let the platform draft and summarise.
          The drafting help is rule-based and labelled as simulated.
        </p>
      </header>
      <section aria-labelledby="tools-h">
        <h2 id="tools-h" className="font-heading text-xl font-bold">
          Where to find things
        </h2>
        <dl className="mt-2 grid gap-3 md:grid-cols-2">
          {TOOLS.map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface p-4">
              <dt className="font-semibold">{t}</dt>
              <dd className="mt-1 text-sm text-text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
      {layouts && (
        <section aria-labelledby="lay-h" className="flex flex-col gap-4">
          <h2 id="lay-h" className="font-heading text-xl font-bold">
            Document layouts
          </h2>
          {layouts.map((l) => (
            <LayoutDesigner key={l.kind} initial={l} csrf={user!.csrfToken} canEdit={canDesign} />
          ))}
        </section>
      )}
      {canContent && <ReferenceContent csrf={user!.csrfToken} canRefresh={canDesign} />}
    </div>
  );
}
