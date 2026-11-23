// pm2 process file:  pm2 start ecosystem.config.cjs
//
// Both servers run from TypeScript source via tsx (node --import tsx), same as `npm run dev`.
// The compiled dist/ build can't run under plain Node yet because many relative imports
// lack ".js" extensions (tsconfig uses moduleResolution "bundler").
//
// Don't use `pm2 start npm -- run ...` on Windows: pm2 tries to execute npm.cmd as JavaScript.
module.exports = {
  apps: [
    {
      name: "agents",
      script: "server.ts", // main API (PORT, default 3002)
      cwd: __dirname,
      interpreter: "node",
      node_args: "--import tsx",
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "whatsapp",
      script: "whatsapp/server.ts", // WhatsApp service (WHATSAPP_PORT, default 3003)
      cwd: __dirname,
      interpreter: "node",
      node_args: "--import tsx",
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
