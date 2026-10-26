'use client';
import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react';

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

const LinkCtx = createContext<ComponentType<LinkProps> | 'a'>('a');

/**
 * Lets an app give the kit its own router link (for example Next.js `Link`) so kit rows, KPI cells and tabs navigate
 * without a full page load. Without a provider they render a plain `<a>`, which is what the unit tests and the gallery use.
 */
export function UiLinkProvider({
  component,
  children,
}: {
  component: ComponentType<LinkProps>;
  children: ReactNode;
}) {
  return <LinkCtx.Provider value={component}>{children}</LinkCtx.Provider>;
}

export function UiLink(props: LinkProps) {
  const C = useContext(LinkCtx);
  return <C {...props} />;
}
