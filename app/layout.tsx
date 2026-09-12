import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Folio — Your workspace",
  description: "A personal workspace for notes, documents, and projects.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
