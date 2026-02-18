import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('README.md documentation links', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const readmePath = path.join(projectRoot, 'README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf-8');

  // Extract all markdown links to docs/ paths
  const linkRegex = /\[([^\]]+)\]\((docs\/[^)]+)\)/g;
  const links: Array<{ text: string; href: string }> = [];
  let match;
  while ((match = linkRegex.exec(readmeContent)) !== null) {
    links.push({ text: match[1], href: match[2] });
  }

  it('should have documentation links in README', () => {
    expect(links.length).toBeGreaterThan(0);
  });

  it.each(links)('link "$text" -> $href should resolve to existing file', ({ href }) => {
    const fullPath = path.join(projectRoot, href);
    const exists = fs.existsSync(fullPath);
    expect(exists, `File not found: ${href}`).toBe(true);
  });

  // Specific critical files that must exist
  const criticalFiles = [
    'docs/playbooks/execution_telemetry.md',
    'docs/reference/config/codemachine_adapter_guide.md',
    'docs/README.md',
    'docs/reference/queue-v2-operations.md',
    'docs/reference/parallel-execution.md',
    'docs/playbooks/log-rotation.md',
  ];

  it.each(criticalFiles)('critical file %s should exist', (href) => {
    const fullPath = path.join(projectRoot, href);
    expect(fs.existsSync(fullPath), `Critical file not found: ${href}`).toBe(true);
  });
});
