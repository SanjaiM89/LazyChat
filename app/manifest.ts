import type { MetadataRoute } from "next";


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
