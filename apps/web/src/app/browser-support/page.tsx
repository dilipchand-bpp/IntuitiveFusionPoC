import Link from 'next/link';
import { BASELINE } from '@if/shared';
import { Logo, Table, Td, Th } from '@if/ui';

export const metadata = { title: 'Supported browsers – Intuitive Fusion' };

/** The published browser and operating-system baseline (NFR-C08). Public: no sign-in needed to read it. */
export default function BrowserSupport() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10">
      <Link href="/" className="w-fit text-text no-underline" aria-label="Home page">
        <Logo withName size={40} />
      </Link>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Supported browsers and devices</h1>
        <p className="mt-2 max-w-prose text-text-muted">
          The portal is tested on the current and recent releases below. Older browsers may still work, but
          some pages may look or behave differently. After you sign in the portal checks your browser, and if
          it is older than this baseline it shows a short, dismissible note. It never stops you working. Last
          reviewed {BASELINE.reviewed}.
        </p>
      </header>

      <section aria-labelledby="b-h" className="flex flex-col gap-3">
        <h2 id="b-h" className="font-heading text-xl font-bold">
          Browsers
        </h2>
        <Table caption="Supported browsers and their oldest supported version">
          <thead>
            <tr>
              <Th>Browser</Th>
              <Th>Oldest version</Th>
              <Th>Where</Th>
            </tr>
          </thead>
          <tbody>
            {BASELINE.browsers.map((b) => (
              <tr key={b.family}>
                <Td label="Browser">{b.family}</Td>
                <Td label="Oldest version">{b.min} or later</Td>
                <Td label="Where">{b.platforms}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="m-h" className="flex flex-col gap-3">
        <h2 id="m-h" className="font-heading text-xl font-bold">
          Phones and tablets
        </h2>
        <Table caption="Supported mobile browsers">
          <thead>
            <tr>
              <Th>Browser</Th>
              <Th>Oldest version</Th>
            </tr>
          </thead>
          <tbody>
            {BASELINE.mobile.map((b) => (
              <tr key={b.name}>
                <Td label="Browser">{b.name}</Td>
                <Td label="Oldest version">{b.min}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-sm text-text-muted">
          On an iPhone or iPad every browser uses the same engine as Safari, so the iOS or iPadOS version is
          what counts.
        </p>
      </section>

      <section aria-labelledby="o-h" className="flex flex-col gap-3">
        <h2 id="o-h" className="font-heading text-xl font-bold">
          Operating systems
        </h2>
        <Table caption="Supported operating systems">
          <thead>
            <tr>
              <Th>System</Th>
              <Th>Oldest version</Th>
            </tr>
          </thead>
          <tbody>
            {BASELINE.operatingSystems.map((o) => (
              <tr key={o.name}>
                <Td label="System">{o.name}</Td>
                <Td label="Oldest version">{o.min}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="f-h" className="flex flex-col gap-2">
        <h2 id="f-h" className="font-heading text-xl font-bold">
          What the portal needs from a browser
        </h2>
        <ul className="list-disc pl-6 text-sm">
          {BASELINE.features.map((f) => (
            <li key={f.key}>{f.label}</li>
          ))}
        </ul>
        <p className="text-sm text-text-muted">
          If your browser does not provide one of these, the portal says so after sign-in. Only the browser
          name, its version and whether it met this baseline are counted, and nothing that identifies you.
        </p>
      </section>

      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
