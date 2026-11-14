import type { ReactNode } from 'react';
import '@kyralabs/m3e-tokens/tokens.css';
import '@kyralabs/m3e-tokens/theme.css';
import '@kyralabs/m3e-css/button.css';
import '@kyralabs/m3e-css/card.css';
import '@kyralabs/m3e-css/top-app-bar.css';
import './globals.css';

export const metadata = { title: 'ReV — handover workspace', description: 'Evidence-linked project handovers' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
