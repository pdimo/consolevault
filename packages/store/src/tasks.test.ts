import { describe, expect, it } from 'vitest';
import { taskId } from './tasks.js';

describe('taskId', () => {
  it('is deterministic for the same cell', () => {
    const a = taskId('domain_example_com', 'web', 'byProperty', '2026-06-15');
    const b = taskId('domain_example_com', 'web', 'byProperty', '2026-06-15');
    expect(a).toBe(b);
    expect(a).toBe('domain_example_com__web__byProperty__20260615');
  });

  it('differs by type, aggregation, and day', () => {
    const base = taskId('p', 'web', 'byProperty', '2026-06-15');
    expect(taskId('p', 'image', 'byProperty', '2026-06-15')).not.toBe(base);
    expect(taskId('p', 'web', 'byPage', '2026-06-15')).not.toBe(base);
    expect(taskId('p', 'web', 'byProperty', '2026-06-16')).not.toBe(base);
  });

  it('uses only Cloud-Tasks-name-safe characters', () => {
    const id = taskId('urlp_www_example_com_blog', 'web', 'byProperty', '2026-06-15');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
