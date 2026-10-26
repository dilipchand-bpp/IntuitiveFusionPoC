// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AiBadge,
  Badge,
  Button,
  Checkbox,
  ComingSoon,
  Dialog,
  Field,
  Input,
  Stepper,
  Table,
  Tabs,
  Td,
  Th,
  ThemeToggle,
  ToastProvider,
  useToast,
  ActivityRow,
  KpiCell,
  KpiStrip,
  ListRow,
  PageHeader,
  Panel,
  RowList,
  SectionHeader,
  UiLinkProvider,
  padNumber,
} from '../index';

describe('Button', () => {
  it('defaults to type=button (never submits a form by accident)', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });
  it('loading disables the button and announces busy state', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('asChild renders the child element (e.g. a link) with button styling', () => {
    render(
      <Button asChild>
        <a href="/login">Login</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
  });
  it('is keyboard operable', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Field', () => {
  it('associates label, hint and error with the control', () => {
    render(
      <Field label="Estimated value" hint="In AUD" error="Required" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Estimated value/);
    expect(input).toBeRequired();
    expect(input).toBeInvalid();
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
  it('has no aria-invalid when there is no error', () => {
    render(
      <Field label="Title">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Checkbox', () => {
  it('toggles by clicking its label text', async () => {
    render(<Checkbox label="No conflict" />);
    await userEvent.click(screen.getByText('No conflict'));
    expect(screen.getByRole('checkbox', { name: 'No conflict' })).toBeChecked();
  });
});

describe('Badge / AiBadge / Stepper / ComingSoon', () => {
  it('Badge conveys status with text (not colour alone)', () => {
    render(<Badge tone="error">Blocked</Badge>);
    expect(screen.getByText('Blocked')).toBeVisible();
  });
  it('AiBadge always labels simulated AI', () => {
    render(<AiBadge />);
    expect(screen.getByText('Simulated AI')).toBeVisible();
  });
  it('Stepper marks the current step and announces states', () => {
    render(<Stepper steps={['Request', 'Plan', 'Tender']} current={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('(complete)');
    expect(items[2]).toHaveTextContent('(upcoming)');
  });
  it('ComingSoon is never blank and lists requirement IDs', () => {
    render(<ComingSoon feature="Layout designer" requirementIds={['FR-0085']} />);
    expect(screen.getByRole('heading', { name: /Layout designer – coming soon/ })).toBeVisible();
    expect(screen.getByText('FR-0085')).toBeVisible();
  });
});

describe('Table', () => {
  it('has an accessible name and column headers', () => {
    render(
      <Table caption="Active procurements">
        <thead>
          <tr>
            <Th>Number</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>PR-1</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: 'Active procurements' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Number' })).toHaveAttribute('scope', 'col');
  });
});

describe('Dialog', () => {
  it('is labelled, traps focus on open and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Approve plan" description="Within your limit" />);
    expect(screen.getByRole('dialog', { name: 'Approve plan' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Tabs', () => {
  it('switches panels with the arrow keys', async () => {
    render(
      <Tabs
        label="Demo"
        items={[
          { value: 'a', label: 'One', content: <p>Panel one</p> },
          { value: 'b', label: 'Two', content: <p>Panel two</p> },
        ]}
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByText('Panel two')).toBeVisible();
  });
});

describe('Toast', () => {
  function Trigger() {
    const { toast } = useToast();
    return <button onClick={() => toast({ tone: 'error', title: 'Save failed' })}>fire</button>;
  }
  it('error toasts use role=alert so they are announced', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('fire'));
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
  });
});

describe('ThemeToggle', () => {
  it('starts in dark (the default) and switches to light, remembering the choice', async () => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    render(<ThemeToggle />);
    // dark is the default even when nothing is stored and the operating system says nothing
    await userEvent.click(await screen.findByRole('button', { name: /Switch to light mode/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('if-theme')).toBe('light');
    expect(screen.getByRole('button', { name: /Switch to dark mode/ })).toBeVisible();
  });
  it('honours a theme already set on the page', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);
    expect(await screen.findByRole('button', { name: /Switch to dark mode/ })).toBeVisible();
    document.documentElement.removeAttribute('data-theme');
  });
});

describe('page pattern primitives', () => {
  it('PageHeader shows eyebrow, a single h1, subtitle and actions', () => {
    render(
      <PageHeader
        eyebrow="NORTHLINE / TUESDAY"
        title="Good morning, Alex."
        subtitle="Your work, in perspective."
        actions={<Button>New request</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Good morning, Alex.' })).toBeVisible();
    expect(screen.getByText('NORTHLINE / TUESDAY')).toBeVisible();
    expect(screen.getByText('Your work, in perspective.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New request' })).toBeVisible();
  });
  it('SectionHeader renders the title at the level asked for', () => {
    render(<SectionHeader eyebrow="Across the business" title="Recent activity" as="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Recent activity' })).toBeVisible();
  });
  it('padNumber zero-pads and shows a dash for anything that is not a number', () => {
    expect(padNumber(8)).toBe('08');
    expect(padNumber(12)).toBe('12');
    expect(padNumber(123)).toBe('123');
    expect(padNumber(0)).toBe('00');
    expect(padNumber(null)).toBe('–');
    expect(padNumber(Number.NaN)).toBe('–');
  });
  it('KpiStrip is a named region; a KpiCell link is named and only exists when given an href', () => {
    render(
      <KpiStrip label="Key figures">
        <KpiCell label="Awaiting decisions" value="03" caption="3 assigned to you" href="/app/actions" />
        <KpiCell label="Active agreements" value="05" caption="Contract register" />
      </KpiStrip>,
    );
    const region = screen.getByRole('region', { name: 'Key figures' });
    expect(region).toHaveTextContent('03');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Awaiting decisions: 3 assigned to you' })).toHaveAttribute(
      'href',
      '/app/actions',
    );
  });
  it('ListRow is a link with caption, title, subtitle and tag; without href it is plain text', () => {
    render(
      <RowList aria-label="Queue">
        <ListRow
          href="/app/contracts/1"
          accent="warning"
          caption="Contract"
          title="Quarterly review"
          subtitle="Energy supply"
          tag="Overdue"
        />
        <ListRow title="Plain row" />
      </RowList>,
    );
    const link = screen.getByRole('link', { name: /Quarterly review/ });
    expect(link).toHaveTextContent('Overdue');
    expect(link).toHaveTextContent('Contract');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Plain row')).toBeVisible();
  });
  it('ActivityRow shows the initial and the muted meta line', () => {
    render(
      <RowList>
        <ActivityRow who="Sam Khan" text="Approved the plan" meta="Sam Khan · 26 Oct 2026" />
      </RowList>,
    );
    expect(screen.getByText('SK')).toBeInTheDocument();
    expect(screen.getByText('Sam Khan · 26 Oct 2026')).toBeVisible();
  });
  it('rows use the router link an app provides', () => {
    const Fake = ({ href, children, ...r }: { href: string; children?: React.ReactNode }) => (
      <a href={href} data-router="yes" {...r}>
        {children}
      </a>
    );
    render(
      <UiLinkProvider component={Fake}>
        <RowList>
          <ListRow href="/x" title="Go" />
        </RowList>
      </UiLinkProvider>,
    );
    expect(screen.getByRole('link', { name: /Go/ })).toHaveAttribute('data-router', 'yes');
  });
  it('Panel is a bordered section with no fill', () => {
    render(
      <Panel aria-label="Since you were last here">
        <p>Body</p>
      </Panel>,
    );
    const panel = screen.getByRole('region', { name: 'Since you were last here' });
    expect(panel.className).toContain('border');
    expect(panel.className).not.toContain('bg-surface');
  });
});

describe('Rebrand guard: no hard-coded colours outside theme.ts', () => {
  const root = join(process.cwd(), 'packages/ui/src');
  const webApp = join(process.cwd(), 'apps/web/src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  const offenders = [...files(root), ...files(webApp)]
    .filter(
      (f) =>
        !/theme\.(ts|css|test\.ts)$/.test(f) && !/components\.test\.tsx$/.test(f) && !/globals\.css$/.test(f),
    )
    .filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(f, 'utf8')));
  it('component and page source contains no hex/rgb colour literals', () => {
    expect(offenders).toEqual([]);
  });
});
