import { describe, it, expect } from 'vitest';
import { formatPlanAsTasks } from '../prompts.js';

describe('formatPlanAsTasks', () => {
  it('parses valid JSON array', () => {
    const input = JSON.stringify([
      { title: 'Task 1', description: 'Desc 1' },
      { title: 'Task 2', description: 'Desc 2' }
    ]);
    const result = formatPlanAsTasks(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: 'Task 1', description: 'Desc 1' });
    expect(result[1]).toMatchObject({ title: 'Task 2', description: 'Desc 2' });
  });

  it('parses text fallback', () => {
    const input = `1. Task 1\nDescription for task 1\n\n2. Task 2\nDescription for task 2`;
    const result = formatPlanAsTasks(input);
    expect(result.length).toBe(2);
    expect(result[0].title).toBe('Task 1');
    expect(result[0].description).toBe('Description for task 1');
  });

  it('returns empty array for empty string', () => {
    expect(formatPlanAsTasks('')).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    const input = '{ not valid json }';
    const result = formatPlanAsTasks(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('handles non-array JSON gracefully', () => {
    const input = JSON.stringify({ not: 'an array' });
    const result = formatPlanAsTasks(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
}); 