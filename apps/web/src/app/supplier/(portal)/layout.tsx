import type { ReactNode } from 'react';
import { SupplierShell } from '@/components/supplier/supplier-shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <SupplierShell>{children}</SupplierShell>;
}
