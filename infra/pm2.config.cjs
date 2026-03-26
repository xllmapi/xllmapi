module.exports = {
  apps: [{
    name: "xllmapi",
    script: "apps/platform-api/dist/main.js",
    instances: "max",
    exec_mode: "cluster",
    wait_ready: true,          // wait for process.send('ready') before routing traffic
    listen_timeout: 10000,     // max ms to wait for ready signal
    kill_timeout: 35000,       // max ms to wait for graceful shutdown (> 30s drain in main.ts)
    env: {
      NODE_ENV: "production",
      XLLMAPI_ENV: "production",
      PORT: 3000,
    },
    max_memory_restart: "512M",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "/var/log/xllmapi/error.log",
    out_file: "/var/log/xllmapi/out.log",
    merge_logs: true,
  }],
};
