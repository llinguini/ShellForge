import type { Config } from "tailwindcss";
import { sf } from "./src/lib/tokens";

const config: Config = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sf: {
          bg: sf.colors.bg,
          s1: sf.colors.s1,
          s2: sf.colors.s2,
          s3: sf.colors.s3,
          b1: sf.colors.b1,
          b2: sf.colors.b2,
          text: sf.colors.text,
          muted: sf.colors.muted,
          subtle: sf.colors.subtle,
        },
      },
      fontFamily: {
        ui: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "monospace"],
        brand: ["Georgia", "serif"],
      },
      fontSize: {
        tab: sf.fontSize.tab,
        menu: sf.fontSize.menu,
      },
      letterSpacing: {
        tab: "0.04em",
      },
      borderColor: {
        "sf-active": "rgba(237, 230, 214, 0.15)",
      },
    },
  },
  plugins: [],
};

export default config;
