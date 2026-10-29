import { fileURLToPath } from 'node:url';
import { shellQuote } from './persistence.js';

export function loginCommand(provider, dir) {
  return [process.execPath, fileURLToPath(new URL('./login.js', import.meta.url)), provider, dir].map(shellQuote).join(' ');
}
