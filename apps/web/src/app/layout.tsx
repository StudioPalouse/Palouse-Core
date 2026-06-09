import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ReqOps',
  description: 'Team task aggregation + agentic handoff',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: 0,
          background: '#0b0d10',
          color: '#e6e6e6',
        }}
      >
        {children}
      </body>
    </html>
  );
}
