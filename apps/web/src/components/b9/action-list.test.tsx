// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_EVENT, type AskEventDetail } from '@/components/shell/ask-ai';
import { ActionList } from './action-list';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const data = {
  count: 2,
  items: [
    {
      key: 'plan:1',
      kind: 'Plan to approve',
      title: 'Cleaning',
      detail: 'R-1: the plan is waiting for your decision',
      link: '/app/plans/1',
    },
    {
      key: 'copilot:g1',
      kind: 'Copilot is waiting',
      title: 'Approve the plan for R-2',
      detail: 'needs a delegate',
      link: '/app/plans/2',
      whatToDo:
        'What to do: Press "Approve and lock" (Dana Okafor). Then the plan is locked. Open /app/plans/2',
      runId: 'run-1',
      gateId: 'g1',
    },
  ],
};
vi.mock('@/components/contract/b5-shared', () => ({ useData: () => ({ data, error: null }) }));

afterEach(() => cleanup());

describe('Waiting for you', () => {
  it('shows the What to do line and a What do I do? button only for a Copilot item', async () => {
    render(<ActionList />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).queryByRole('button', { name: 'What do I do?' })).toBeNull();
    const line = within(rows[1]!).getByTestId('action-what-to-do');
    expect(line).toHaveTextContent(
      'What to do: Press "Approve and lock" (Dana Okafor). Then the plan is locked.',
    );
    expect(line.textContent).not.toMatch(/Open \/app/);
  });

  it('opens Ask on the run and the card the item belongs to', async () => {
    const seen: AskEventDetail[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<AskEventDetail>).detail);
    window.addEventListener(ASK_EVENT, on);
    render(<ActionList />);
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'What do I do?' }));
    });
    window.removeEventListener(ASK_EVENT, on);
    expect(seen).toEqual([{ question: 'What do I do?', path: '/app/copilot/run-1', gateId: 'g1' }]);
  });
});
