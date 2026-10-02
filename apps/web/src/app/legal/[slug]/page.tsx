import { notFound } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/landing/site-chrome';

const PAGES: Record<string, { title: string; body: string[] }> = {
  privacy: {
    title: 'Privacy policy',
    body: [
      'This is a proof of concept. It runs on synthetic data and does not collect, store or share personal information about real people.',
      'A production privacy policy aligned to the Privacy Act 1988 and the Australian Privacy Principles will replace this text before any real use.',
    ],
  },
  terms: {
    title: 'Terms of use',
    body: [
      'This site is a demonstration. It is provided as is, without warranty, for evaluation only.',
      'Production terms of use will be supplied after legal review.',
    ],
  },
  accessibility: {
    title: 'Accessibility statement',
    body: [
      'We aim for WCAG 2.1 Level AA. Automated checks (axe-core) run on key pages in light and dark themes and at phone, tablet and desktop widths.',
      'Automated checks do not find every issue. A manual keyboard and screen-reader review is planned. If you meet a barrier, please contact us using the address in the footer.',
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(PAGES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = PAGES[(await params).slug];
  return { title: p ? `${p.title} – Intuitive Fusion` : 'Not found' };
}

// TODO: replace placeholder text with reviewed legal copy (not legal advice).
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = PAGES[(await params).slug];
  if (!page) notFound();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-4xl font-bold">{page.title}</h1>
        <p className="mt-2 rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm font-medium text-warning">
          Placeholder text pending legal review.
        </p>
        <div className="mt-6 flex flex-col gap-4 text-text-muted">
          {page.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
