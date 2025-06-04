import { describe, it, expect } from 'vitest';
import { getParentIdFromTaskId } from '../storage';

describe('getParentIdFromTaskId', () => {
  it('should return null for a top-level task ID', () => {
    expect(getParentIdFromTaskId('1')).toBeNull();
    expect(getParentIdFromTaskId('10')).toBeNull();
  });

  it('should return the correct parent ID for a first-level subtask', () => {
    expect(getParentIdFromTaskId('1.1')).toBe('1');
    expect(getParentIdFromTaskId('10.5')).toBe('10');
  });

  it('should return the correct parent ID for a nested subtask', () => {
    expect(getParentIdFromTaskId('1.1.1')).toBe('1.1');
    expect(getParentIdFromTaskId('10.5.2')).toBe('10.5');
    expect(getParentIdFromTaskId('1.2.3.4')).toBe('1.2.3');
  });

  it('should handle task IDs with multiple dots correctly', () => {
    expect(getParentIdFromTaskId('a.b.c')).toBe('a.b');
    expect(getParentIdFromTaskId('task.subtask.item')).toBe('task.subtask');
  });

  it('should return null for an empty string', () => {
    expect(getParentIdFromTaskId('')).toBeNull();
  });

  it('should return null for a task ID that is just a number string', () => {
    expect(getParentIdFromTaskId('123')).toBeNull();
  });
});
