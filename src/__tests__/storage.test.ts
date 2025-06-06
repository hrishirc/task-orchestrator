import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Storage } from '../storage.js';
import path from 'path';
import fs from 'fs';

describe('Storage', () => {
  let storage: Storage;

  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(__dirname, 'files', 'test_storage.db');
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
      await new Promise<void>((resolve) => {
        (storage as any).db.close(() => {
          // Ignore errors during close for cleanup purposes
          resolve();
        });
      });
    }

    // Clean up all files related to the test database
    const dir = path.dirname(dbPath);
    const baseName = path.basename(dbPath);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        if (file.startsWith(baseName)) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch (e) {
            console.warn(`Could not delete file ${file}:`, e);
          }
        }
      });
    }
  });

  describe('Storage Constructor and Initialization', () => {
    const tempDir = path.join(__dirname, 'temp_db_tests');
    const tempDbPath = path.join(tempDir, 'temp_test.db');

    beforeEach(() => {
      // Clean up temp directory before each test
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    afterEach(() => {
      // Clean up temp directory after each test
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      // Clear the environment variable if it was set
      delete process.env.MCP_DB_PATH;
    });

    it('should create the database directory if it does not exist', async () => {
      const newStorage = new Storage(tempDbPath);
      await newStorage.initialize();
      expect(fs.existsSync(tempDir)).toBe(true);
      await new Promise<void>((resolve) => {
        (newStorage as any).db.close(() => resolve());
      });
    });

    it('should use the provided dbPath', async () => {
      const newStorage = new Storage(tempDbPath);
      await newStorage.initialize();
      expect((newStorage as any).db.filename).toBe(tempDbPath);
      await new Promise<void>((resolve) => {
        (newStorage as any).db.close(() => resolve());
      });
    });

    it('should use MCP_DB_PATH environment variable if set', async () => {
      process.env.MCP_DB_PATH = tempDbPath;
      const newStorage = new Storage(); // No path provided, should use env var
      await newStorage.initialize();
      expect((newStorage as any).db.filename).toBe(tempDbPath);
      await new Promise<void>((resolve) => {
        (newStorage as any).db.close(() => resolve());
      });
    });

    it('should load the database', async () => {
      await storage.initialize();
      // If no error is thrown, the test passes
      expect(true).toBe(true);
    });

    it('should initialize nextTaskId if missing from metadata', async () => {
      // Clear metadata and insert an object without nextTaskId
      const metadataCollection = (storage as any).db.getCollection('metadata');
      metadataCollection.clear();
      metadataCollection.insert({}); // Insert metadata without nextTaskId

      // Re-initialize storage to trigger the logic
      await storage.initialize();

      // Verify that nextTaskId was added
      const updatedMetadata = metadataCollection.findOne({});
      expect(updatedMetadata.nextTaskId).toEqual({});
    });
  });

  describe('createGoal', () => {
    it('should create a new goal', async () => {
      const description = 'Test goal';
      const repoName = 'https://github.com/test/repo';
      const goal = await storage.createGoal(description, repoName);
      expect(goal).toMatchObject({
        id: 1,
        description,
        repoName,
        createdAt: expect.any(String),
      });
    });
  });

  describe('getGoal', () => {
    it('should return a goal by id', async () => {
      const description = 'Test goal';
      const repoName = 'https://github.com/test/repo';
      const goal = await storage.createGoal(description, repoName);
      
      const fetched = await storage.getGoal(goal.id);
      expect(fetched).toMatchObject({
        id: goal.id,
        description: goal.description,
        repoName: goal.repoName,
        createdAt: goal.createdAt
      });
    });

    it('should return null for non-existent goal', async () => {
      const goal = await storage.getGoal(999);
      expect(goal).toBeNull();
    });
  });

  describe('createPlan', () => {
    it('should create a new plan', async () => {
      const description = 'Test goal';
      const repoName = 'https://github.com/test/repo';
      const goal = await storage.createGoal(description, repoName);
      const plan = await storage.createPlan(goal.id);
      expect(plan).toMatchObject({
        goalId: goal.id,
        tasks: [],
        updatedAt: expect.any(String),
      });
    });
  });

  describe('getPlan', () => {
    it('should return a plan by goalId', async () => {
      const description = 'Test goal';
      const repoName = 'https://github.com/test/repo';
      const goal = await storage.createGoal(description, repoName);
      const plan = await storage.createPlan(goal.id);
      const fetched = await storage.getPlan(goal.id);
      expect(fetched).toMatchObject(plan);
    });

    it('should return null for non-existent plan', async () => {
      const plan = await storage.getPlan(999);
      expect(plan).toBeNull();
    });
  });

  describe('addTask', () => {
    it('should add a new task', async () => {
      const description = 'Test goal';
      const repoName = 'https://github.com/test/repo';
      const goal = await storage.createGoal(description, repoName);
      await storage.createPlan(goal.id);
      const taskData = {
        title: 'Test task',
        description: 'Test description',
        parentId: null,
        deleted: false,
      };
      const task = await storage.addTask(goal.id, taskData);
      expect(task).toMatchObject({
        id: '1',
        goalId: goal.id,
        title: taskData.title,
        description: taskData.description,
        isComplete: false,
        deleted: false, // New expectation
      });
    });

    it('should add a task with an existing parent ID', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent Task', description: '', parentId: null, deleted: false });
      const childTask = await storage.addTask(goal.id, { title: 'Child Task', description: '', parentId: parentTask.id, deleted: false });

      expect(childTask.id).toBe(`${parentTask.id}.1`);
      expect(childTask.goalId).toBe(goal.id);
      expect(childTask.title).toBe('Child Task');
    });

    it('should throw error if parentId does not exist', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      await expect(
        storage.addTask(goal.id, { title: 'Orphan Task', description: '', parentId: 'NonExistentParent', deleted: false })
      ).rejects.toThrow('Parent task with ID "NonExistentParent" not found for goal 1.');
    });

    it('should throw error if plan not found', async () => {
      await expect(
        storage.addTask(1, {
          title: 'Test task',
          description: 'Test description',
          parentId: null,
          deleted: false,
        })
      ).rejects.toThrow('No plan found for goal 1');
    });

    it('should throw error if metadata collection not found when adding task', async () => {
      // Temporarily mock the findOne method of the metadata collection to return null
      const metadataCollection = (storage as any).db.getCollection('metadata');
      const originalFindOne = metadataCollection.findOne;
      metadataCollection.findOne = vi.fn(() => null);

      // Create a goal and plan first, as addTask checks for plan existence before metadata
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);

      await expect(
        storage.addTask(goal.id, {
          title: 'Task without metadata',
          description: 'This task should fail due to missing metadata',
          parentId: null,
          deleted: false,
        })
      ).rejects.toThrow('Metadata collection not found or empty.');

      // Restore original findOne
      metadataCollection.findOne = originalFindOne;
    });
  });

  describe('updateParentTaskStatus (private method)', () => {
    let goalId: number;
    let parentTask: any;
    let child1: any;
    let child2: any;
    let deletedChild: any;

    beforeEach(async () => {
      const goal = await storage.createGoal('Test Goal for Parent Status', 'https://github.com/test/parentstatus');
      await storage.createPlan(goal.id);
      goalId = goal.id;

      const parentTaskResponse = await storage.addTask(goalId, { title: 'Parent', description: '', parentId: null, deleted: false });
      const child1Response = await storage.addTask(goalId, { title: 'Child 1', description: '', parentId: parentTaskResponse.id, deleted: false });
      const child2Response = await storage.addTask(goalId, { title: 'Child 2', description: '', parentId: parentTaskResponse.id, deleted: false });
      const deletedChildResponse = await storage.addTask(goalId, { title: 'Deleted Child', description: '', parentId: parentTaskResponse.id, deleted: false });
      
      // Soft delete one child
      await storage.removeTasks(goalId, [deletedChildResponse.id]);

      // Retrieve the actual LokiJS documents for manipulation in tests
      parentTask = (storage as any).tasks.findOne({ id: parentTaskResponse.id });
      child1 = (storage as any).tasks.findOne({ id: child1Response.id });
      child2 = (storage as any).tasks.findOne({ id: child2Response.id });
      deletedChild = (storage as any).tasks.findOne({ id: deletedChildResponse.id });
    });

    it('should make parent incomplete if a non-deleted child becomes incomplete', async () => {
      // Mark all non-deleted children complete first
      // We need to re-fetch the children to ensure they are the latest LokiJS documents
      const currentChild1 = (storage as any).tasks.findOne({ id: child1.id });
      const currentChild2 = (storage as any).tasks.findOne({ id: child2.id });
      await storage.completeTasksStatus(goalId, [currentChild1.id, currentChild2.id]);
      
      let currentParent = (storage as any).tasks.findOne({ id: parentTask.id });
      expect(currentParent.isComplete).toBe(true);

      // Now mark one non-deleted child incomplete
      const child1ToUpdate = (storage as any).tasks.findOne({ id: child1.id });
      child1ToUpdate.isComplete = false;
      (storage as any).tasks.update(child1ToUpdate);
      await (storage as any).save(); // Save changes to trigger updateParentTaskStatus

      const updatedParent = await (storage as any).updateParentTaskStatus(goalId, parentTask.id);
      expect(updatedParent).toMatchObject({ id: parentTask.id, isComplete: false });
    });

    it('should keep parent complete if a deleted child becomes incomplete', async () => {
      // Mark all non-deleted children complete
      const currentChild1 = (storage as any).tasks.findOne({ id: child1.id });
      const currentChild2 = (storage as any).tasks.findOne({ id: child2.id });
      await storage.completeTasksStatus(goalId, [currentChild1.id, currentChild2.id]);
      
      let currentParent = (storage as any).tasks.findOne({ id: parentTask.id });
      expect(currentParent.isComplete).toBe(true);

      // Mark the deleted child incomplete (should not affect parent)
      const deletedChildToUpdate = (storage as any).tasks.findOne({ id: deletedChild.id });
      deletedChildToUpdate.isComplete = false;
      (storage as any).tasks.update(deletedChildToUpdate);
      await (storage as any).save();

      const updatedParent = await (storage as any).updateParentTaskStatus(goalId, parentTask.id);
      expect(updatedParent).toBeNull(); // No change to parent status
      currentParent = (storage as any).tasks.findOne({ id: parentTask.id });
      expect(currentParent.isComplete).toBe(true);
    });

    it('should keep parent incomplete if not all non-deleted children are complete', async () => {
      // Parent is initially incomplete
      let currentParent = (storage as any).tasks.findOne({ id: parentTask.id });
      expect(currentParent.isComplete).toBe(false);

      // Mark only one child complete
      await storage.completeTasksStatus(goalId, [child1.id]);

      const updatedParent = await (storage as any).updateParentTaskStatus(goalId, parentTask.id);
      expect(updatedParent).toBeNull(); // No change to parent status
      currentParent = (storage as any).tasks.findOne({ id: parentTask.id });
      expect(currentParent.isComplete).toBe(false);
    });
  });

  describe('completeTasksStatus', () => {
    it('should update task status and parent task if needed', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      const childTask = await storage.addTask(goal.id, { title: 'Child', description: '', parentId: parentTask.id, deleted: false });
      const result = await storage.completeTasksStatus(goal.id, [childTask.id]);
      expect(result.updatedTasks.length).toBe(1);
    });

    it('should not complete parent if non-deleted children are incomplete and completeChildren is false', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      const child1 = await storage.addTask(goal.id, { title: 'Child 1', description: '', parentId: parentTask.id, deleted: false });
      const child2 = await storage.addTask(goal.id, { title: 'Child 2', description: '', parentId: parentTask.id, deleted: false });
      
      // Mark child2 complete
      await storage.completeTasksStatus(goal.id, [child2.id]);

      // Try to mark parent complete without completing all non-deleted children
      const result = await storage.completeTasksStatus(goal.id, [parentTask.id], false);
      expect(result.updatedTasks).toHaveLength(0); // Parent should not be updated
      const updatedParent = await storage.getTasks(goal.id, undefined, 'none');
      expect(updatedParent.find(t => t.id === parentTask.id)?.isComplete).toBe(false);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Task ${parentTask.id} cannot be marked complete because not all its non-deleted subtasks are complete.`
      );
      consoleWarnSpy.mockRestore();
    });

    it('should complete parent and all children recursively when completeChildren is true', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      const child1 = await storage.addTask(goal.id, { title: 'Child 1', description: '', parentId: parentTask.id, deleted: false });
      const child2 = await storage.addTask(goal.id, { title: 'Child 2', description: '', parentId: parentTask.id, deleted: false });
      const grandChild = await storage.addTask(goal.id, { title: 'Grandchild', description: '', parentId: child1.id, deleted: false });

      // Mark parent complete with completeChildren: true
      const result = await storage.completeTasksStatus(goal.id, [parentTask.id], true);
      
      // Expect parent and all children to be updated
      expect(result.updatedTasks).toHaveLength(4); // Parent, child1, child2, grandchild
      
      const allTasks = await storage.getTasks(goal.id, undefined, 'recursive');
      expect(allTasks.find(t => t.id === parentTask.id)?.isComplete).toBe(true);
      expect(allTasks.find(t => t.id === child1.id)?.isComplete).toBe(true);
      expect(allTasks.find(t => t.id === child2.id)?.isComplete).toBe(true);
      expect(allTasks.find(t => t.id === grandChild.id)?.isComplete).toBe(true);
    });

    it('should not update task status if already complete', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const task = await storage.addTask(goal.id, { title: 'Already Complete', description: '', parentId: null, deleted: false });
      await storage.completeTasksStatus(goal.id, [task.id]); // Mark complete once

      const result = await storage.completeTasksStatus(goal.id, [task.id]); // Try to mark complete again
      expect(result.updatedTasks).toHaveLength(0); // Should not be updated again
    });

    it('should ignore deleted children when determining completion status', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      const child1 = await storage.addTask(goal.id, { title: 'Child 1', description: '', parentId: parentTask.id, deleted: false });
      const deletedChild = await storage.addTask(goal.id, { title: 'Deleted Child', description: '', parentId: parentTask.id, deleted: false });
      
      await storage.removeTasks(goal.id, [deletedChild.id]); // Soft delete one child

      // Complete the only non-deleted child
      const result = await storage.completeTasksStatus(goal.id, [child1.id]);
      expect(result.updatedTasks).toHaveLength(1); // Child1 updated
      expect(result.completedParents).toHaveLength(1); // Parent updated

      const updatedParent = await storage.getTasks(goal.id, undefined, 'none');
      expect(updatedParent.find(t => t.id === parentTask.id)?.isComplete).toBe(true);
    });

    it('should throw error if plan not found', async () => {
      await expect(storage.completeTasksStatus(999, ['999'])).rejects.toThrow('No plan found for goal 999');
    });
  });

  describe('removeTasks (soft delete)', () => {
    it('should prevent soft deleting parent task with children without deleteChildren flag', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      await storage.addTask(goal.id, { title: 'Child', description: '', parentId: parentTask.id, deleted: false });

      await expect(storage.removeTasks(goal.id, [parentTask.id], false)).rejects.toThrow(
        `Task ${parentTask.id} has subtasks and cannot be deleted without explicitly setting 'deleteChildren' to true.`
      );
    });

    it('should soft delete a single top-level task', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null, deleted: false });

      const result = await storage.removeTasks(goal.id, [task1.id]);
      expect(result.removedTasks.length).toBe(1);
      expect(result.removedTasks[0].id).toBe(task1.id);
      expect(result.removedTasks[0].deleted).toBe(true);

      const allTasksInDb = (storage as any).tasks.find({ goalId: goal.id });
      expect(allTasksInDb.find((t: any) => t.id === task1.id)?.deleted).toBe(true);
      const nonDeletedTasks = await storage.getTasks(goal.id, undefined, 'recursive');
      expect(nonDeletedTasks).toHaveLength(0);
    });

    it('should soft delete a subtask', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      const subTask = await storage.addTask(goal.id, { title: 'Sub', description: '', parentId: parentTask.id, deleted: false });

      const result = await storage.removeTasks(goal.id, [subTask.id]);
      expect(result.removedTasks.length).toBe(1);
      expect(result.removedTasks[0].id).toBe(subTask.id);
      expect(result.removedTasks[0].deleted).toBe(true);

      const allTasksInDb = (storage as any).tasks.find({ goalId: goal.id });
      expect(allTasksInDb.find((t: any) => t.id === subTask.id)?.deleted).toBe(true);
      const nonDeletedTasks = await storage.getTasks(goal.id, undefined, 'recursive');
      expect(nonDeletedTasks).toHaveLength(1); // Parent should still be there
      expect(nonDeletedTasks[0].id).toBe(parentTask.id);
    });

    it('should soft delete a parent task and all its subtasks recursively when deleteChildren is true', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null, deleted: false });
      const childTask = await storage.addTask(goal.id, { title: 'Child', description: '', parentId: parentTask.id, deleted: false });
      const grandChild = await storage.addTask(goal.id, { title: 'Grandchild', description: '', parentId: childTask.id, deleted: false });

      const result = await storage.removeTasks(goal.id, [parentTask.id], true);
      
      expect(result.removedTasks.length).toBe(3);
      expect(result.removedTasks.find(t => t.id === parentTask.id)).toMatchObject({ deleted: true });
      expect(result.removedTasks.find(t => t.id === childTask.id)).toMatchObject({ deleted: true });
      expect(result.removedTasks.find(t => t.id === grandChild.id)).toMatchObject({ deleted: true });

      const allTasksInDb = (storage as any).tasks.find({ goalId: goal.id });
      expect(allTasksInDb.find((t: any) => t.id === parentTask.id)?.deleted).toBe(true);
      expect(allTasksInDb.find((t: any) => t.id === childTask.id)?.deleted).toBe(true);
      expect(allTasksInDb.find((t: any) => t.id === grandChild.id)?.deleted).toBe(true);

      const nonDeletedTasks = await storage.getTasks(goal.id, undefined, 'recursive');
      expect(nonDeletedTasks).toHaveLength(0);
    });

    it('should throw error if plan not found', async () => {
      await expect(storage.removeTasks(999, ['999'])).rejects.toThrow('No plan found for goal 999');
    });

    it('should not reorder sibling tasks and update their IDs after soft removal', async () => {
      const goal = await storage.createGoal('Test Goal for No Reordering', 'https://github.com/test/noreorder');
      await storage.createPlan(goal.id);

      // Add top-level tasks
      const task1 = await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null, deleted: false }); // id: "1"
      const task2 = await storage.addTask(goal.id, { title: 'Task 2', description: '', parentId: null, deleted: false }); // id: "2"
      const task3 = await storage.addTask(goal.id, { title: 'Task 3', description: '', parentId: null, deleted: false }); // id: "3"

      await storage.removeTasks(goal.id, [task2.id]); // Soft delete Task 2

      // Verify IDs remain constant
      const allTasks = await storage.getTasks(goal.id, undefined, 'recursive', true); // Get all tasks including deleted
      expect(allTasks.length).toBe(3);
      expect(allTasks.find(t => t.id === '1')?.title).toBe('Task 1');
      expect(allTasks.find(t => t.id === '2')?.title).toBe('Task 2');
      expect(allTasks.find(t => t.id === '2')?.deleted).toBe(true);
      expect(allTasks.find(t => t.id === '3')?.title).toBe('Task 3');

      // Verify non-deleted tasks are returned correctly
      const nonDeletedTasks = await storage.getTasks(goal.id, undefined, 'recursive', false);
      expect(nonDeletedTasks.length).toBe(2);
      expect(nonDeletedTasks[0].id).toBe('1');
      expect(nonDeletedTasks[1].id).toBe('3');
    });

  });

  describe('getTasks', () => {
    let goalId: number;
    let task1: any, task2: any, task3: any, child1_1: any, child1_2: any, grandChild1_1_1: any;

    beforeEach(async () => {
      const goal = await storage.createGoal('Test Goal for getTasks', 'https://github.com/test/gettasks');
      await storage.createPlan(goal.id);
      goalId = goal.id;

      task1 = await storage.addTask(goalId, { title: 'Task 1', description: '', parentId: null, deleted: false }); // 1
      child1_1 = await storage.addTask(goalId, { title: 'Child 1.1', description: '', parentId: task1.id, deleted: false }); // 1.1
      grandChild1_1_1 = await storage.addTask(goalId, { title: 'Grandchild 1.1.1', description: '', parentId: child1_1.id, deleted: false }); // 1.1.1
      child1_2 = await storage.addTask(goalId, { title: 'Child 1.2', description: '', parentId: task1.id, deleted: false }); // 1.2
      task2 = await storage.addTask(goalId, { title: 'Task 2', description: '', parentId: null, deleted: false }); // 2
      task3 = await storage.addTask(goalId, { title: 'Task 3', description: '', parentId: null, deleted: false }); // 3

      // Soft delete task2
      await storage.removeTasks(goalId, [task2.id]);
    });

    it('should return tasks without subtasks (excluding deleted by default)', async () => {
      const tasks = await storage.getTasks(goalId, undefined, 'none');
      expect(tasks.length).toBe(2); // Task 1, Task 3
      expect(tasks.map(t => t.id)).toEqual(['1', '3']);
    });

    it('should return tasks with first-level subtasks (excluding deleted by default)', async () => {
      const tasks = await storage.getTasks(goalId, undefined, 'first-level');
      expect(tasks.length).toBe(4); // Task 1, Child 1.1, Child 1.2, Task 3
      expect(tasks.map(t => t.id)).toEqual(['1', '1.1', '1.2', '3']);
    });

    it('should return tasks with recursive subtasks (excluding deleted by default)', async () => {
      const tasks = await storage.getTasks(goalId, undefined, 'recursive');
      expect(tasks.length).toBe(5); // Task 1, Child 1.1, Grandchild 1.1.1, Child 1.2, Task 3
      expect(tasks.map(t => t.id)).toEqual(['1', '1.1', '1.1.1', '1.2', '3']);
    });

    it('should return deleted tasks when includeDeletedTasks is true', async () => {
      const tasks = await storage.getTasks(goalId, undefined, 'recursive', true); // Include deleted
      expect(tasks.length).toBe(6); // All tasks including deleted Task 2
      expect(tasks.find(t => t.id === task2.id)).toMatchObject({ deleted: true });
    });

    it('should return only non-deleted tasks when includeDeletedTasks is false', async () => {
      const tasks = await storage.getTasks(goalId, undefined, 'recursive', false); // Exclude deleted (default)
      expect(tasks.length).toBe(5);
      expect(tasks.find(t => t.id === task2.id)).toBeUndefined();
    });

    // New tests for taskIds parameter
    it('should return a single task when taskId is provided', async () => {
      const tasks = await storage.getTasks(goalId, [task1.id]);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe(task1.id);
      expect(tasks[0].title).toBe('Task 1');
    });

    it('should return multiple tasks when taskIds are provided', async () => {
      const tasks = await storage.getTasks(goalId, [child1_1.id, child1_2.id]);
      expect(tasks.length).toBe(2);
      expect(tasks.map(t => t.id)).toEqual(['1.1', '1.2']);
    });

    it('should return a deleted task when its taskId is provided and includeDeletedTasks is true', async () => {
      const tasks = await storage.getTasks(goalId, [task2.id], 'none', true);
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe(task2.id);
      expect(tasks[0].deleted).toBe(true);
    });

    it('should not return a deleted task when its taskId is provided and includeDeletedTasks is false', async () => {
      const tasks = await storage.getTasks(goalId, [task2.id], 'none', false);
      expect(tasks.length).toBe(0);
    });

    it('should return a task and its first-level children when parent taskId is provided and includeSubtasks is first-level', async () => {
      const tasks = await storage.getTasks(goalId, [task1.id], 'first-level');
      expect(tasks.length).toBe(3); // Task 1, Child 1.1, Child 1.2
      expect(tasks.map(t => t.id)).toEqual(['1', '1.1', '1.2']);
    });

    it('should return a task and its recursive children when parent taskId is provided and includeSubtasks is recursive', async () => {
      const tasks = await storage.getTasks(goalId, [task1.id], 'recursive');
      expect(tasks.length).toBe(4); // Task 1, Child 1.1, Grandchild 1.1.1, Child 1.2
      expect(tasks.map(t => t.id)).toEqual(['1', '1.1', '1.1.1', '1.2']);
    });

    it('should handle empty taskIds array gracefully', async () => {
      const tasks = await storage.getTasks(goalId, [], 'recursive', true);
      // As per tool description, if taskIds is empty, all tasks for the goal should be fetched.
      // In this test setup, there are 6 tasks in total, including the deleted one.
      expect(tasks.length).toBe(6);
    });

    it('should return tasks in correct order when multiple taskIds are provided', async () => {
      const tasks = await storage.getTasks(goalId, [task3.id, child1_1.id, task1.id], 'none');
      expect(tasks.length).toBe(3);
      // The order should be based on the internal sorting of getTasks, not the input order
      expect(tasks.map(t => t.id)).toEqual(['1', '1.1', '3']);
    });
  });

  describe('edge cases', () => {
    it('updateParentTaskStatus should update parent if all non-deleted siblings complete', async () => {
      // Setup: parent exists, all non-deleted siblings complete, parent not complete
      const goalId = 1;
      const parentId = '10';
      const parentTask = { id: parentId, goalId, parentId: null, isComplete: false, updatedAt: '', deleted: false, $loki: 1, meta: {} };
      const siblingTasks = [
        { id: '11', goalId, parentId, isComplete: true, deleted: false },
        { id: '12', goalId, parentId, isComplete: true, deleted: false },
        { id: '13', goalId, parentId, isComplete: false, deleted: true }, // Deleted and incomplete
      ];
      
      // Mock the collection methods
      const mockUpdate = vi.fn();
      (storage as any).tasks = {
        findOne: vi.fn().mockReturnValue(parentTask),
        find: vi.fn((query: any) => {
          // Simulate finding only non-deleted tasks for parent status check
          if (query.deleted === false) {
            return siblingTasks.filter(t => !t.deleted);
          }
          return siblingTasks; // For other finds
        }),
        update: mockUpdate
      };
      
      const result = await (storage as any).updateParentTaskStatus(goalId, parentId);
      
      // Verify the result
      expect(result).toMatchObject({ id: parentId, isComplete: true });
      // Verify that update was called with the correct arguments
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        id: parentId,
        isComplete: true
      }));
    });

    it('handles removing non-existent task', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const result = await storage.removeTasks(goal.id, ['999']);
      expect(result.removedTasks).toEqual([]);
      expect(result.completedParents).toEqual([]);
    });

    it('handles updating non-existent task', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const result = await storage.completeTasksStatus(goal.id, ['999']);
      expect(result.updatedTasks).toEqual([]);
      expect(result.completedParents).toEqual([]);
    });

    it('handles recursive subtask updates considering deleted tasks', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { 
        title: 'Task 1',
        description: '',
        parentId: null,
        deleted: false
      });
      const task2 = await storage.addTask(goal.id, { 
        title: 'Task 2',
        description: '',
        parentId: task1.id,
        deleted: false
      });
      const task3 = await storage.addTask(goal.id, { 
        title: 'Task 3',
        description: '',
        parentId: task2.id,
        deleted: false
      });
      
      // Try to mark parent task complete when children are not complete
      await storage.completeTasksStatus(goal.id, [task1.id]);
      let tasks = await storage.getTasks(goal.id, undefined, 'recursive');
      let updatedTask1 = tasks.find(t => t.id === task1.id);
      let updatedTask2 = tasks.find(t => t.id === task2.id);
      let updatedTask3 = tasks.find(t => t.id === task3.id);
      
      // Parent task should not be complete because children are not complete
      expect(updatedTask1?.isComplete).toBe(false);
      expect(updatedTask2?.isComplete).toBe(false);
      expect(updatedTask3?.isComplete).toBe(false);
      
      // Now complete all non-deleted children
      await storage.completeTasksStatus(goal.id, [task3.id]);
      await storage.completeTasksStatus(goal.id, [task2.id]);
      
      // Now try to complete parent
      await storage.completeTasksStatus(goal.id, [task1.id]);
      const finalTasks = await storage.getTasks(goal.id, undefined, 'recursive');
      const finalTask1 = finalTasks.find(t => t.id === task1.id);
      expect(finalTask1?.isComplete).toBe(true);
    });

    it('handles parent status updates considering deleted tasks', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { 
        title: 'Task 1',
        description: '',
        parentId: null,
        deleted: false
      });
      const task2 = await storage.addTask(goal.id, { 
        title: 'Task 2',
        description: '',
        parentId: task1.id,
        deleted: false
      });
      const task3 = await storage.addTask(goal.id, { 
        title: 'Task 3',
        description: '',
        parentId: task1.id,
        deleted: false
      });
      
      // Soft delete task3
      await storage.removeTasks(goal.id, [task3.id]);

      // Complete task2 (the only remaining non-deleted child)
      await storage.completeTasksStatus(goal.id, [task2.id]);
      
      const tasks = await storage.getTasks(goal.id, undefined, 'none');
      const updatedTask1 = tasks.find(t => t.id === task1.id);
      expect(updatedTask1?.isComplete).toBe(true); // Parent should be complete
    });

    it('completes parent task when pending non-deleted subtask is deleted and all remaining non-deleted subtasks are complete', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      
      // Create a parent task with three subtasks
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
      
      const subtask3 = await storage.addTask(goal.id, { 
        title: 'Subtask 3',
        description: '',
        parentId: parentTask.id,
        deleted: false
      });

      // Complete two subtasks
      await storage.completeTasksStatus(goal.id, [subtask1.id, subtask2.id]);
      
      // Soft delete the pending subtask
      const result = await storage.removeTasks(goal.id, [subtask3.id]);
      
      // Verify that the parent task was completed
      expect(result.completedParents).toHaveLength(1);
      expect(result.completedParents[0].id).toBe(parentTask.id);
      expect(result.completedParents[0].isComplete).toBe(true);
    });

    it('should not reorder sibling tasks and update their IDs after soft removal', async () => {
      const goal = await storage.createGoal('Test Goal for No Reordering', 'https://github.com/test/noreorder');
      await storage.createPlan(goal.id);

      // Add top-level tasks
      const task1 = await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null, deleted: false }); // id: "1"
      const task2 = await storage.addTask(goal.id, { title: 'Task 2', description: '', parentId: null, deleted: false }); // id: "2"
      const task3 = await storage.addTask(goal.id, { title: 'Task 3', description: '', parentId: null, deleted: false }); // id: "3"

      // Add subtasks to Task 2
      const subtask2_1 = await storage.addTask(goal.id, { title: 'Subtask 2.1', description: '', parentId: task2.id, deleted: false }); // id: "2.1"
      const subtask2_2 = await storage.addTask(goal.id, { title: 'Subtask 2.2', description: '', parentId: task2.id, deleted: false }); // id: "2.2"

      // Soft remove Task 1 (top-level)
      const removeResult1 = await storage.removeTasks(goal.id, [task1.id]);
      expect(removeResult1.removedTasks.length).toBe(1);
      expect(removeResult1.removedTasks[0].id).toBe(task1.id);
      expect(removeResult1.removedTasks[0].deleted).toBe(true);

      // Verify top-level tasks IDs are NOT reordered
      const allTasksInDb = (storage as any).tasks.find({ goalId: goal.id });
      expect(allTasksInDb.find((t: any) => t.id === '1')?.title).toBe('Task 1');
      expect(allTasksInDb.find((t: any) => t.id === '1')?.deleted).toBe(true);
      expect(allTasksInDb.find((t: any) => t.id === '2')?.title).toBe('Task 2');
      expect(allTasksInDb.find((t: any) => t.id === '3')?.title).toBe('Task 3');

      // Verify getTasks (default, no deleted) returns correct order and IDs
      const nonDeletedTopLevelTasks = await storage.getTasks(goal.id, undefined, 'none');
      expect(nonDeletedTopLevelTasks.length).toBe(2);
      expect(nonDeletedTopLevelTasks[0].id).toBe('2'); // Original Task 2
      expect(nonDeletedTopLevelTasks[1].id).toBe('3'); // Original Task 3

      // Verify subtasks of original Task 2 still have their original parentId
      const directChildrenOfTask2 = await storage.getTasks(goal.id, undefined, 'first-level');
      const childrenOfOriginalTask2 = directChildrenOfTask2.filter(t => t.id.startsWith('2.'));

      expect(childrenOfOriginalTask2.length).toBe(2);
      expect(childrenOfOriginalTask2[0].id).toBe('2.1');
      expect(childrenOfOriginalTask2[0].title).toBe('Subtask 2.1');
      expect(childrenOfOriginalTask2[1].id).toBe('2.2');
      expect(childrenOfOriginalTask2[1].title).toBe('Subtask 2.2');
    });
  });
});
