import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

// Fieldwork typography: one workhorse family (IBM Plex Sans) for headings, body,
// and UI; hierarchy comes from size and weight, never a second voice. Plex Mono
// carries code, task IDs, and agent identifiers. See docs/design-system.md.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
