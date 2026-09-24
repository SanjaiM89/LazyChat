import type { MetadataRoute } from "next";

/* ------------------------------------------------------------------ */
/*  Web app manifest — served by Next at /manifest.webmanifest         */
/*  (file convention: Next emits the <link rel="manifest"> tag itself, */
/*  so app/layout.tsx must NOT also declare `metadata.manifest`.)       */
/* ------------------------------------------------------------------ */

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Omnia — AI Workspace",
    short_name: "Omnia",
    description:
      "Multi-provider AI chat, agents, artifacts, deep research and sandboxed file work — like Claude, self-hosted.",
    start_url: "/",
    display: "standalone",
    background_color: "#1a1918",
    theme_color: "#1a1918",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
