import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bridle — an agent that lives in a folder",
  description:
    "Open-source, native macOS agent harness for one person. Chat, goals, a board, notes, calendar and mail, all plain files you own.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
