import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Constit — Campaign operations, simplified",
  description: "Import contacts, generate constituent messages, coordinate volunteers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
