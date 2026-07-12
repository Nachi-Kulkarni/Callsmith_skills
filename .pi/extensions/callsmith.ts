import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(extensionDir, '../../skills');

export default function callsmithPiExtension(pi: any) {
  pi.on('resources_discover', async () => ({ skillPaths: [skillsDir] }));
}
