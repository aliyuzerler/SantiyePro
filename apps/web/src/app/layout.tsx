import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ŞantiyePro — Yönetim Paneli',
  description: 'Şantiye ve inşaat takip sistemi — web yönetim paneli',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
