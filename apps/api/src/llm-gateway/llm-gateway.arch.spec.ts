import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('LLM Gateway architecture', () => {
  it('no module outside llm-gateway imports @anthropic-ai/sdk', () => {
    const srcDir = join(__dirname, '..'); // apps/api/src
    const violations: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !full.includes('llm-gateway') && !full.includes('node_modules')) walk(full);
        else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) && !full.includes('llm-gateway')) {
          const content = readFileSync(full, 'utf-8');
          if (content.includes('@anthropic-ai/sdk')) violations.push(full.replace(srcDir, ''));
        }
      }
    };
    walk(srcDir);
    expect(violations).toEqual([]);
  });
});
