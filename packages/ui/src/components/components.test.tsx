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
  it('sets data-theme and remembers the choice', async () => {
    window.matchMedia ??= ((q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole('button', { name: /Switch to dark mode/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('if-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /Switch to light mode/ })).toBeVisible();
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
