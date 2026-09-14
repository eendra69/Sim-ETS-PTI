import { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
}
export function AppShell({ children }: AppShellProps) {
  return <main>{children}</main>;
}
