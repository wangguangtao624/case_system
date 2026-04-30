import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '测试用例管理平台',
  description: '测试用例数据的统一管理与协作平台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
