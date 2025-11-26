
import fs from 'fs';
import path from 'path';

const tenantId = process.env['VITE_AZURE-TENANT_ID'];
if (!tenantId) {
  console.error('❌ VITE_AZURE-TENANT_ID is missing. Check your environment variables.');
  process.exit(1);
}

const configPath = path.resolve('src/config.json'); // adjust if needed
let config = fs.readFileSync(configPath, 'utf8');

// Replace placeholder
config = config.replace(/__TENANT_ID__/g, tenantId);

fs.writeFileSync(configPath, config);
console.log(`✅ Injected tenant ID (${tenantId}) into config.json`);
