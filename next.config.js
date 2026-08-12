const { withWorkflow } = require("workflow/next");

/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "ffmpeg-static",
    ],
  },
};

module.exports = withWorkflow(nextConfig);