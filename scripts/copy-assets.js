const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDb = path.join(root, 'dist', 'db');
const distDashboard = path.join(root, 'dist', 'dashboard');
const distLanding = path.join(root, 'dist', 'landing');

fs.mkdirSync(distDb, { recursive: true });
fs.copyFileSync(
  path.join(root, 'src', 'db', 'schema.sql'),
  path.join(distDb, 'schema.sql')
);

fs.mkdirSync(distDashboard, { recursive: true });
fs.cpSync(
  path.join(root, 'src', 'dashboard'),
  distDashboard,
  { recursive: true }
);

fs.mkdirSync(distLanding, { recursive: true });
fs.cpSync(
  path.join(root, 'src', 'landing'),
  distLanding,
  { recursive: true }
);

console.log('[build] Static assets (schema.sql, dashboard, landing) copied to dist/');
