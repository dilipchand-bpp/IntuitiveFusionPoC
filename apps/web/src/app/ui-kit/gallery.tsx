'use client';
import { useState } from 'react';
import {
  AiBadge,
  Badge,
  Button,
  Card,
  Checkbox,
  ComingSoon,
  Dialog,
  EmptyState,
  Field,
  Input,
  Logo,
  Select,
  Skeleton,
  Stamp,
  Stepper,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  ThemeToggle,
  useToast,
} from '@if/ui';

const swatches = [
  ['primary', 'bg-primary'],
  ['accent', 'bg-accent'],
  ['secondary (icons / large text only)', 'bg-secondary'],
  ['silver', 'bg-silver'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['error', 'bg-error'],
  ['info', 'bg-info'],
] as const;

export function Gallery() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  return (
    <div>
      <header className="flex items-center justify-between bg-primary px-4 py-3 text-primary-fg sm:px-6">
        <Logo withName />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6">
        <section aria-labelledby="h-intro">
          <h1 id="h-intro" className="text-3xl font-bold">
            UI kit
          </h1>
          <p className="mt-2 text-text-muted">
            Every colour, font, radius and shadow here comes from{' '}
            <code className="font-mono">packages/ui/src/theme.ts</code>.
          </p>
        </section>

        <section aria-labelledby="h-colour" className="flex flex-col gap-3">
          <h2 id="h-colour" className="text-2xl font-semibold">
            Colour tokens
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {swatches.map(([name, cls]) => (
              <li
                key={name}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm font-semibold text-text"
              >
                <span aria-hidden="true" className={`block h-10 rounded-sm border border-border ${cls}`} />
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-type" className="flex flex-col gap-2">
          <h2 id="h-type" className="text-2xl font-semibold">
            Typography
          </h2>
          <p className="font-heading text-4xl font-bold">Plus Jakarta Sans – headings</p>
          <p className="text-base">
            Inter – body text. The quick brown fox jumps over the lazy dog 0123456789.
          </p>
          <p className="text-sm text-text-muted">Muted small text for secondary information.</p>
        </section>

        <section aria-labelledby="h-buttons" className="flex flex-col gap-3">
          <h2 id="h-buttons" className="text-2xl font-semibold">
            Buttons
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        <section aria-labelledby="h-form" className="flex flex-col gap-3">
          <h2 id="h-form" className="text-2xl font-semibold">
            Form controls
          </h2>
          <Card className="grid gap-4 sm:grid-cols-2">
            <Field label="Procurement title" hint="Plain language is fine." required>
              <Input placeholder="Facilities cleaning services" />
            </Field>
            <Field label="Estimated value" error="Enter a value greater than zero.">
              <Input defaultValue="-1" inputMode="decimal" />
            </Field>
            <Field label="Category">
              <Select defaultValue="facilities">
                <option value="facilities">Facilities</option>
                <option value="it">IT services</option>
              </Select>
            </Field>
            <Field label="Background">
              <Textarea defaultValue="Existing contract expires in six months." />
            </Field>
            <Checkbox label="I have no conflict of interest to declare" />
          </Card>
        </section>

        <section aria-labelledby="h-status" className="flex flex-col gap-3">
          <h2 id="h-status" className="text-2xl font-semibold">
            Status, AI and approval
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Draft</Badge>
            <Badge tone="success">Approved</Badge>
            <Badge tone="warning">Due in 7 days</Badge>
            <Badge tone="error">Blocked</Badge>
            <Badge tone="info">In evaluation</Badge>
            <AiBadge />
            <AiBadge kind="drafted" />
          </div>
          <Stamp label="Approved" who="Dana Okafor" role="Delegate L2" when="2 Oct 2026, 10:15 AEST" />
          <Stepper steps={['Request', 'Plan', 'Tender', 'Evaluate', 'Contract']} current={2} />
        </section>

        <section aria-labelledby="h-table" className="flex flex-col gap-3">
          <h2 id="h-table" className="text-2xl font-semibold">
            Table and tabs
          </h2>
          <Tabs
            label="Table demo"
            items={[
              {
                value: 'a',
                label: 'Active',
                content: (
                  <Table caption="Active procurements">
                    <thead>
                      <tr>
                        <Th>Number</Th>
                        <Th>Title</Th>
                        <Th>Phase</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <Td>PR-2026-0001</Td>
                        <Td>Facilities cleaning</Td>
                        <Td>Tender</Td>
                        <Td>
                          <Badge tone="info">Published</Badge>
                        </Td>
                      </tr>
                      <tr>
                        <Td>PR-2026-0002</Td>
                        <Td>Managed IT services</Td>
                        <Td>Plan</Td>
                        <Td>
                          <Badge tone="warning">Awaiting approval</Badge>
                        </Td>
                      </tr>
                    </tbody>
                  </Table>
                ),
              },
              {
                value: 'b',
                label: 'Closed',
                content: <EmptyState title="Nothing closed yet" body="Closed procurements appear here." />,
              },
            ]}
          />
        </section>

        <section aria-labelledby="h-fb" className="flex flex-col gap-3">
          <h2 id="h-fb" className="text-2xl font-semibold">
            Feedback and states
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Open dialog
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast({ tone: 'success', title: 'Plan approved', body: 'Locked and audited.' })}
            >
              Show toast
            </Button>
          </div>
          <Skeleton className="h-6 w-64" label="Loading plan" />
          <ComingSoon
            feature="Drag-and-drop layout designer"
            requirementIds={['FR-0085', 'FR-0115', 'FR-0365']}
          />
        </section>
      </main>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Approve procurement plan"
        description="You are approving PR-2026-0001 within your delegation limit."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Approve</Button>
          </>
        }
      >
        <p>Approval locks the plan. Only Procurement can reopen it, with a reason.</p>
      </Dialog>
    </div>
  );
}
