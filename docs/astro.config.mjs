import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeGalaxy from "starlight-theme-galaxy";

export default defineConfig({
  site: "https://rennerdo30.github.io/send-to-cytube",
  base: "/send-to-cytube",
  integrations: [
    starlight({
      title: "Send to CyTube",
      description:
        "Chrome extension that queues the current YouTube video into an open CyTube channel tab, plus a channel-JS SponsorBlock client.",
      plugins: [starlightThemeGalaxy()],
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/rennerdo30/send-to-cytube" },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Configuration", slug: "getting-started/configuration" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Usage", slug: "guides/usage" },
            { label: "Channel Targeting", slug: "guides/channel-targeting" },
            { label: "SponsorBlock", slug: "guides/sponsorblock" },
            { label: "Architecture", slug: "guides/architecture" },
          ],
        },
      ],
    }),
  ],
});
