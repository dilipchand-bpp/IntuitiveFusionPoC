// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_EVENT, AskAi, askContext, startersFor, type AskEventDetail } from './ask-ai';

let path = '/app/requests/new';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const apiMock = vi.fn();
vi.mock('@/lib/api-client', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/api-client')),
  api: (...a: unknown[]) => apiMock(...a),
}));

const ID = '11111111-2222-4333-8444-555555555555';
const REPLY = {
  topic: 'copilot',
  answer: 'Approve the plan for R-1. Here is exactly where to go and what to do.',
  bullets: ['Who must do it: Dana Okafor (not you).'],
  steps: [
    'Open the plan.',
    'Press "Approve and lock".',
    'Go back to the Copilot run and press "Advance now".',
  ],
  actions: [{ label: 'Open the plan (or Approvals)', href: '/app/plans/abc' }],
  followUps: [],
  model: 'rules-simulated-v1',
  modelSimulated: true,
  footer: 'Answered by fixed rules.',
  from: 'From: Copilot guidance catalogue and this run (read as you)',
};

beforeEach(() => {
  path = '/app/requests/new';
  apiMock.mockReset();
  apiMock.mockResolvedValue(REPLY);
  sessionStorage.clear();
});
afterEach(() => cleanup());

describe('Ask: the renamed button and panel', () => {
  it('is called Ask everywhere the person sees it, and keeps the simulated label', async () => {
    render(<AskAi csrf="c" />);
    const btn = screen.getByTestId('ask-ai-button');
    expect(btn).toHaveTextContent(/^Ask$/);
    expect(document.body.textContent).not.toMatch(/Ask AI/);
    await userEvent.click(btn);
    const panel = screen.getByRole('dialog', { name: 'Ask' });
    expect(within(panel).getByRole('heading', { name: 'Ask' })).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/Ask AI/);
    expect(within(panel).getByText(/simulated/i)).toBeInTheDocument();
  });

  it('says which page it is asking about', async () => {
    render(<AskAi csrf="c" />);
    await userEvent.click(screen.getByTestId('ask-ai-button'));
    expect(screen.getByTestId('ask-page')).toHaveTextContent('New request');
  });
});

describe('Ask: the page context it sends', () => {
  it('sends the route path with the question', async () => {
    render(<AskAi csrf="c" />);
    await userEvent.click(screen.getByTestId('ask-ai-button'));
    await userEvent.type(screen.getByLabelText('Your question'), 'What is this page?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const [url, opts] = apiMock.mock.calls[0]!;
    expect(url).toBe('/assistant/chat');
    expect(opts.body).toMatchObject({
      message: 'What is this page?',
      page: '/app/requests/new',
      context: { path: '/app/requests/new' },
    });
    expect(opts.body.context.entityId).toBeUndefined();
  });

  it('sends the record id where the path has one (a request, a plan, a Copilot run)', async () => {
    for (const [p, type] of [
      [`/app/requests/${ID}`, 'request'],
      [`/app/plans/${ID}`, 'plan'],
      [`/app/copilot/${ID}`, 'copilot-run'],
      [`/app/tenders/${ID}`, 'tender'],
      [`/app/evaluations/${ID}`, 'evaluation'],
      [`/app/contracts/${ID}`, 'contract'],
    ] as const) {
      expect(askContext(p)).toEqual({ path: p, entityType: type, entityId: ID });
    }
    expect(askContext(`/app/copilot/${ID}`, '99999999-2222-4333-8444-555555555555')).toMatchObject({
      gateId: '99999999-2222-4333-8444-555555555555',
    });
    expect(askContext(null)).toBeUndefined();

    path = `/app/requests/${ID}`;
    apiMock.mockClear();
    render(<AskAi csrf="c" />);
    await userEvent.click(screen.getByTestId('ask-ai-button'));
    await userEvent.click(screen.getByRole('button', { name: /What is this page/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0]![1].body.context).toEqual({
      path,
      entityType: 'request',
      entityId: ID,
    });
  });

  it('offers questions that fit the page, and "What do I do?" on a Copilot run', () => {
    expect(startersFor('/app/requests/new', false)).toContain('What can I do here?');
    expect(startersFor(`/app/copilot/${ID}`, false)[0]).toBe('What do I do?');
    expect(startersFor(`/app/requests/${ID}`, false).join(' ')).toMatch(/status/);
    expect(startersFor('/supplier', true)).toContain('How do I respond to a tender?');
  });

  it('opens and asks when the Copilot run page sends "What do I do?" for a waiting card', async () => {
    path = `/app/copilot/${ID}`;
    render(<AskAi csrf="c" />);
    const gateId = '99999999-2222-4333-8444-555555555555';
    act(() => {
      window.dispatchEvent(
        new CustomEvent<AskEventDetail>(ASK_EVENT, { detail: { question: 'What do I do?', gateId } }),
      );
    });
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0]![1].body).toMatchObject({
      message: 'What do I do?',
      context: { path, entityType: 'copilot-run', entityId: ID, gateId },
    });
    expect(await screen.findByTestId('ask-ai-panel')).toBeInTheDocument();
  });

  it('asks about the run a list item belongs to, when the event carries a path', async () => {
    path = '/app/actions';
    render(<AskAi csrf="c" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent<AskEventDetail>(ASK_EVENT, {
          detail: { question: 'What do I do?', path: `/app/copilot/${ID}` },
        }),
      );
    });
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0]![1].body.context).toMatchObject({ entityType: 'copilot-run', entityId: ID });
  });
});

describe('Ask: showing the answer', () => {
  it('shows numbered steps, the link and where the answer came from', async () => {
    render(<AskAi csrf="c" />);
    await userEvent.click(screen.getByTestId('ask-ai-button'));
    await userEvent.click(screen.getByRole('button', { name: 'What can I do here?' }));
    const answer = await screen.findByTestId('ai-answer');
    const steps = within(answer).getByTestId('ai-steps');
    expect(steps.tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(answer).getByRole('link', { name: 'Open the plan (or Approvals)' })).toHaveAttribute(
      'href',
      '/app/plans/abc',
    );
    expect(within(answer).getByTestId('ai-from')).toHaveTextContent(/^From: Copilot guidance/);
    expect(within(answer).getByTestId('ai-model')).toHaveTextContent('rules-simulated-v1');
  });
});
