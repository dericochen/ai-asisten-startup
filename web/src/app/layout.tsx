import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'AI Startup Company OS', description: 'Owner console for an AI-staffed software company' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
