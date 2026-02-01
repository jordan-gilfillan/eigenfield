import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Journal Distiller",
  description: "Convert AI conversation exports into auditable, reproducible curated datasets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
