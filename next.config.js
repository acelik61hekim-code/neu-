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
      "/api/recover-video": [
        "./node_modules/ffmpeg-static/ffmpeg*",
      ],
    },
  },
};

const workflowConfig = withWorkflow(nextConfig);

module.exports = async (phase, context) => {
  const config = await workflowConfig(phase, context);

  // workflow@4 also prepares the newer top-level Turbopack option. Next 14
  // does not recognize it and this project uses the configured webpack path.
  delete config.turbopack;

  return config;
};
