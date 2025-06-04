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
        parentId: null
      });
      
      const task2 = await storage.addTask(goal.id, { 
        title: 'Parent Task 2',
        description: '',
        parentId: null
      });

      expect(task1.id).toBe('1');
      expect(task2.id).toBe('2');
    });

    it('should create subtasks with dot-notation IDs', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null
      });
      
      const subtask1 = await storage.addTask(goal.id, { 
        title: 'Subtask 1',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask2 = await storage.addTask(goal.id, { 
        title: 'Subtask 2',
        description: '',
        parentId: parentTask.id
      });

      expect(subtask1.id).toBe('1.1');
      expect(subtask2.id).toBe('1.2');
    });

    it('should create nested subtasks with multiple levels', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null
      });
      
      const subtask = await storage.addTask(goal.id, { 
        title: 'Subtask',
        description: '',
        parentId: parentTask.id
      });
      
      const nestedSubtask = await storage.addTask(goal.id, { 
        title: 'Nested Subtask',
        description: '',
        parentId: subtask.id
      });

      expect(nestedSubtask.id).toBe('1.1.1');
    });
  });

  describe('Task ID Reordering', () => {
    it('should reorder sibling tasks when a task is deleted', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null
      });
      
      // Create subtasks 1.1, 1.2, 1.3, 1.4
      const subtask1 = await storage.addTask(goal.id, { 
        title: 'Subtask 1',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask2 = await storage.addTask(goal.id, { 
        title: 'Subtask 2',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask3 = await storage.addTask(goal.id, { 
        title: 'Subtask 3',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask4 = await storage.addTask(goal.id, { 
        title: 'Subtask 4',
        description: '',
        parentId: parentTask.id
      });

      // Delete subtask 1.3
      await storage.removeTasks(goal.id, [subtask3.id]);

      // Get all tasks and verify reordering
      const tasks = await storage.getTasks(goal.id, 'first-level');
      // Filter for direct children of parentTask by checking if their ID starts with parentTask.id + '.'
      const remainingSubtasks = tasks.filter(t => t.id.startsWith(`${parentTask.id}.`));
      
      expect(remainingSubtasks).toHaveLength(3);
      expect(remainingSubtasks[0].id).toBe('1.1');
      expect(remainingSubtasks[1].id).toBe('1.2');
      expect(remainingSubtasks[2].id).toBe('1.3'); // Former 1.4 should become 1.3
    });

    it('should reorder nested subtasks when a parent task is deleted', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null
      });
      
      // Create subtasks 1.1, 1.2, 1.3
      const subtask1 = await storage.addTask(goal.id, { 
        title: 'Subtask 1',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask2 = await storage.addTask(goal.id, { 
        title: 'Subtask 2',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask3 = await storage.addTask(goal.id, { 
        title: 'Subtask 3',
        description: '',
        parentId: parentTask.id
      });

      // Add nested subtasks to subtask2 (1.2.1, 1.2.2)
      const nestedSubtask1 = await storage.addTask(goal.id, { 
        title: 'Nested Subtask 1',
        description: '',
        parentId: subtask2.id
      });
      
      const nestedSubtask2 = await storage.addTask(goal.id, { 
        title: 'Nested Subtask 2',
        description: '',
        parentId: subtask2.id
      });

      // Delete subtask2 (1.2)
      await storage.removeTasks(goal.id, [subtask2.id], true); // Added deleteChildren: true

      // Get all tasks and verify that subtask2 and its nested subtasks are deleted
      const tasks = await storage.getTasks(goal.id, 'recursive');
      // Filter for direct children of parentTask
      const remainingSubtasks = tasks.filter(t => t.id.startsWith(`${parentTask.id}.`));
      // Filter for nested subtasks of original subtask2 (which should now be deleted)
      const deletedNestedSubtasks = tasks.filter(t => t.id.startsWith(`${subtask2.id}.`));
      
      expect(remainingSubtasks).toHaveLength(2);
      expect(remainingSubtasks[0].id).toBe('1.1');
      expect(remainingSubtasks[1].id).toBe('1.2'); // Former 1.3 should become 1.2
      // Nested subtasks should be deleted
      expect(deletedNestedSubtasks).toHaveLength(0);
    });

    it('should maintain task hierarchy when reordering', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null
      });
      
      // Create a complex hierarchy
      const subtask1 = await storage.addTask(goal.id, { 
        title: 'Subtask 1',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask2 = await storage.addTask(goal.id, { 
        title: 'Subtask 2',
        description: '',
        parentId: parentTask.id
      });
      
      const nestedSubtask1 = await storage.addTask(goal.id, { 
        title: 'Nested Subtask 1',
        description: '',
        parentId: subtask1.id
      });
      
      const nestedSubtask2 = await storage.addTask(goal.id, { 
        title: 'Nested Subtask 2',
        description: '',
        parentId: subtask1.id
      });

      // Delete subtask1
      await storage.removeTasks(goal.id, [subtask1.id], true); // Added deleteChildren: true

      // Get all tasks and verify hierarchy is maintained (subtask1 and its nested subtasks are deleted)
      const tasks = await storage.getTasks(goal.id, 'recursive');
      // Filter for direct children of parentTask
      const remainingSubtasks = tasks.filter(t => t.id.startsWith(`${parentTask.id}.`));
      // Filter for nested subtasks of original subtask1 (which should now be deleted)
      const deletedNestedSubtasks = tasks.filter(t => t.id.startsWith(`${subtask1.id}.`));
      
      expect(remainingSubtasks).toHaveLength(1);
      expect(remainingSubtasks[0].id).toBe('1.1'); // Former 1.2 should become 1.1
      // Nested subtasks should be deleted
      expect(deletedNestedSubtasks).toHaveLength(0);
    });

    it('should correctly reorder siblings after a middle task is deleted (simplified)', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      const parentTask = await storage.addTask(goal.id, { 
        title: 'Parent Task',
        description: '',
        parentId: null
      });
      
      // Create subtasks 1.1, 1.2, 1.3
      const subtask1 = await storage.addTask(goal.id, { 
        title: 'Subtask 1',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask2 = await storage.addTask(goal.id, { 
        title: 'Subtask 2',
        description: '',
        parentId: parentTask.id
      });
      
      const subtask3 = await storage.addTask(goal.id, { 
        title: 'Subtask 3',
        description: '',
        parentId: parentTask.id
      });

      // Delete subtask 1.2
      await storage.removeTasks(goal.id, [subtask2.id], true);

      // Get all tasks and verify reordering
      const tasks = await storage.getTasks(goal.id, 'first-level');
      // Filter for direct children of parentTask
      const remainingSubtasks = tasks.filter(t => t.id.startsWith(`${parentTask.id}.`));
      
      expect(remainingSubtasks).toHaveLength(2);
      expect(remainingSubtasks[0].id).toBe('1.1');
      expect(remainingSubtasks[1].id).toBe('1.2'); // Former 1.3 should become 1.2
    });
  });
});
