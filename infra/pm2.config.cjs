module.exports = {
  apps: [{
    name: "xllmapi",
    script: "apps/platform-api/dist/main.js",
    instances: "max",
    exec_mode: "cluster",
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
