import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.palouse.ai'),
  title: 'Palouse',
  description: 'Team task aggregation + agentic handoff',
  openGraph: {
    title: 'Palouse',
    description: "One inbox for your team's tasks, wherever they live, with agent handoffs you can audit.",
    images: [{ url: '/brand/cover.png', width: 3500, height: 1440 }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
