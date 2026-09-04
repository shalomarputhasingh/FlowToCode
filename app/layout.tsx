import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowToCode — Flowchart to code",
  description: "Turn a flowchart image into runnable Python, C, and Java with Gemini.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
