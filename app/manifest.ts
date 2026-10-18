import type { MetadataRoute } from "next";


export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Omnia — AI Workspace",
    short_name: "Omnia",
    description:
      "Multi-provider AI chat, agents, artifacts, deep research and sandboxed file work — like Claude, self-hosted.",
    start_url: "/",
    display: "standalone",
    background_color: "#121212",
    theme_color: "#121212",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/brand/omnia-mark-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/omnia-mark.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
