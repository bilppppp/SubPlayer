/**
 * PM2 process configuration for 宝塔面板 deployment.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart all
 *   pm2 logs gateway
 */
module.exports = {
  apps: [
    {
      name: "gateway",
      cwd: "./services/gateway",
      script: "src/index.ts",
      interpreter: "bun",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        GATEWAY_PORT: 8080,
      },
    },
    // ── 仅在自建 GPU 服务器上启用 ──────────────────────────────────
    // {
    //   name: "asr",
    //   cwd: ".",
    //   script: ".venv/bin/uvicorn",
    //   args: "services.asr.app.main:app --host 127.0.0.1 --port 8765",
    //   interpreter: "none",
    //   instances: 1,
    //   autorestart: true,
    //   watch: false,
    //   max_memory_restart: "2G",
    //   env: {
    //     PYTHONPATH: ".",
    //   },
    // },
  ],
};
