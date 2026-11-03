// Evita tuberías heredadas por el servidor temporal al invocar pg_ctl desde Windows PowerShell.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.argv[2], process.argv.slice(3), { stdio: 'ignore', windowsHide: true });
process.exit(result.status ?? 1);
