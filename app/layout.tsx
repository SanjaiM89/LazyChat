import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";

export const metadata: Metadata = {
  title: "Omnia — AI Workspace",
  description:
    "Multi-provider AI chat, agents, artifacts, deep research and sandboxed file work — like Claude, self-hosted.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

// Apply the persisted theme before first paint so the page never flashes the wrong palette.
// Dark is the default; a v3 store sitting on "system" is migrated to dark by the store, and
// this mirrors that so the first paint is already dark.
const themeBoot = `try{var s=JSON.parse(localStorage.getItem("omnia-store")||"{}");var st=(s&&s.state)||{};var t=st.theme;if(t==="system"&&(s.version||0)<4)t="dark";document.documentElement.dataset.theme=t||"dark";}catch(e){document.documentElement.dataset.theme="dark";}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Merriweather:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
