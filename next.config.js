const { withWorkflow } = require("workflow/next");

/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "ffmpeg-static",
    ],
    outputFileTracingIncludes: {
      "/.well-known/workflow/v1/step": [
        "./node_modules/ffmpeg-static/ffmpeg*",
      ],
    },
  },
};

module.exports = withWorkflow(nextConfig);