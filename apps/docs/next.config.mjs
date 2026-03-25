import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    // Enable useEffectEvent in server components
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default withMDX(config);
