import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['.', 'public'].flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && f !== 'integration.test.js').map((f) => `${dir}/${f}`));
const result = spawnSync(process.execPath, ['--import', './test/setup.js', '--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
