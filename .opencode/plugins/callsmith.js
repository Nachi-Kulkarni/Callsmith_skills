import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillsDir = path.join(pluginRoot, 'skills');

export const CallsmithPlugin = async () => ({
  config: async (config) => {
    config.skills ??= {};
    config.skills.paths ??= [];
    if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);

    config.mcp ??= {};
    config.mcp.context7 ??= {
      type: 'local',
      command: ['npx', '-y', '@upstash/context7-mcp'],
      enabled: true,
    };
  },
});

export default CallsmithPlugin;
