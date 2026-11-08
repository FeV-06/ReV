import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'ReV — handover workspace', description: 'Evidence-linked project handovers' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
