import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../storage.js';
import path from 'path';
import fs from 'fs';

describe('Task ID Management', () => {
  let storage: Storage;

  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(__dirname, 'files', 'test_tasks.db');
    storage = new Storage(dbPath);
    await storage.initialize();
    // Reset the DB to ensure IDs start from 1
    (storage as any).goals.clear();
    (storage as any).plans.clear();
    (storage as any).tasks.clear();
    // Reset metadata collection
    const metadataCollection = (storage as any).db.getCollection('metadata');
    if (metadataCollection) {
      metadataCollection.clear();
      metadataCollection.insert({ nextTaskId: {} });
    }
  });

  afterEach(async () => {
    // Ensure the database is closed before attempting to delete the file
    if ((storage as any).db && (storage as any).db.close) {
      await new Promise<void>((resolve, reject) => {
        (storage as any).db.close((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Clean up all files related to the test database
    const dir = path.dirname(dbPath);
    const baseName = path.basename(dbPath);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        if (file.startsWith(baseName)) {
          fs.unlinkSync(path.join(dir, file));
        }
      });
    }
  });

  describe('Task ID Format', () => {
    it('should create parent tasks with simple numeric IDs', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const task1 = await storage.addTask(goal.id, { 
        title: 'Parent Task 1',
        description: '',
        parentId: null,
        deleted: false
      });
      
      const task2 = await storage.addTask(goal.id, { 
        title: 'Parent Task 2',
        description: '',
        parentId: null,
        deleted: false
      });

      expect(task1.id).toBe('1');
      expect(task2.id).toBe('2');
      expect(task1.deleted).toBe(false);
      expect(task2.deleted).toBe(false);
    });

    it('should create subtasks with dot-notation IDs', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null,
        deleted: false
      });
      
      const subtask1 = await storage.addTask(goal.id, { 
        title: 'Subtask 1',
        description: '',
        parentId: parentTask.id,
        deleted: false
      });
      
      const subtask2 = await storage.addTask(goal.id, { 
        title: 'Subtask 2',
        description: '',
        parentId: parentTask.id,
        deleted: false
      });

      expect(subtask1.id).toBe('1.1');
      expect(subtask2.id).toBe('1.2');
      expect(subtask1.deleted).toBe(false);
      expect(subtask2.deleted).toBe(false);
    });

    it('should create nested subtasks with multiple levels', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null,
        deleted: false
      });
      
      const subtask = await storage.addTask(goal.id, { 
        title: 'Subtask',
        description: '',
        parentId: parentTask.id,
        deleted: false
      });
      
      const nestedSubtask = await storage.addTask(goal.id, { 
        title: 'Nested Subtask',
        description: '',
        parentId: subtask.id,
        deleted: false
      });

      expect(nestedSubtask.id).toBe('1.1.1');
      expect(nestedSubtask.deleted).toBe(false);
    });
  });

  // Removed 'Task ID Reordering' tests as per new requirements (soft delete, constant IDs)
});
