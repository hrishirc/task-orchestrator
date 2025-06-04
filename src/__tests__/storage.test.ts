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

  describe('initialize', () => {
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
      };
      const task = await storage.addTask(goal.id, taskData);
      expect(task).toMatchObject({
        id: '1',
        goalId: goal.id,
        title: taskData.title,
        description: taskData.description,
        isComplete: false,
      });
    });

    it('should throw error if plan not found', async () => {
      await expect(
        storage.addTask(1, {
          title: 'Test task',
          description: 'Test description',
          parentId: null,
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
        })
      ).rejects.toThrow('Metadata collection not found or empty.');

      // Restore original findOne
      metadataCollection.findOne = originalFindOne;
    });
  });

  describe('updateTasksStatus', () => {
    it('should update task status and parent task if needed', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      const childTask = await storage.addTask(goal.id, { title: 'Child', description: '', parentId: parentTask.id });
      const result = await storage.completeTasksStatus(goal.id, [childTask.id]);
      expect(result.updatedTasks.length).toBe(1);
    });


    it('should not complete parent if children are incomplete and completeChildren is false', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      const child1 = await storage.addTask(goal.id, { title: 'Child 1', description: '', parentId: parentTask.id });
      const child2 = await storage.addTask(goal.id, { title: 'Child 2', description: '', parentId: parentTask.id });
      
      // Mark child2 complete
      await storage.completeTasksStatus(goal.id, [child2.id]);

      // Try to mark parent complete without completing all children
      const result = await storage.completeTasksStatus(goal.id, [parentTask.id], false);
      expect(result.updatedTasks).toHaveLength(0); // Parent should not be updated
      const updatedParent = await storage.getTasks(goal.id, 'none');
      expect(updatedParent.find(t => t.id === parentTask.id)?.isComplete).toBe(false);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `Task ${parentTask.id} cannot be marked complete because not all its subtasks are complete.`
      );
      consoleWarnSpy.mockRestore();
    });

    it('should complete parent and all children recursively when completeChildren is true', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      const child1 = await storage.addTask(goal.id, { title: 'Child 1', description: '', parentId: parentTask.id });
      const child2 = await storage.addTask(goal.id, { title: 'Child 2', description: '', parentId: parentTask.id });
      const grandChild = await storage.addTask(goal.id, { title: 'Grandchild', description: '', parentId: child1.id });

      // Mark parent complete with completeChildren: true
      const result = await storage.completeTasksStatus(goal.id, [parentTask.id], true);
      
      // Expect parent and all children to be updated
      expect(result.updatedTasks).toHaveLength(4); // Parent, child1, child2, grandchild
      
      const allTasks = await storage.getTasks(goal.id, 'recursive');
      expect(allTasks.find(t => t.id === parentTask.id)?.isComplete).toBe(true);
      expect(allTasks.find(t => t.id === child1.id)?.isComplete).toBe(true);
      expect(allTasks.find(t => t.id === child2.id)?.isComplete).toBe(true);
      expect(allTasks.find(t => t.id === grandChild.id)?.isComplete).toBe(true);
    });

    it('should throw error if plan not found', async () => {
      await expect(storage.completeTasksStatus(999, ['999'])).rejects.toThrow('No plan found for goal 999');
    });
  });

  describe('removeTasks', () => {
    it('should prevent deleting parent task with children without deleteChildren flag', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      await storage.addTask(goal.id, { title: 'Child', description: '', parentId: parentTask.id });

      await expect(storage.removeTasks(goal.id, [parentTask.id], false)).rejects.toThrow(
        `Task ${parentTask.id} has subtasks and cannot be deleted without explicitly setting 'deleteChildren' to true.`
      );
    });

    it('should remove tasks and their subtasks', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      const subTask = await storage.addTask(goal.id, { title: 'Sub', description: '', parentId: parentTask.id });
      const result = await storage.removeTasks(goal.id, [parentTask.id], true); // Added deleteChildren: true
      expect(result.removedTasks.length).toBe(2);
      expect(result.removedTasks.find(t => t.id === parentTask.id)).toBeTruthy();
      expect(result.removedTasks.find(t => t.id === subTask.id)).toBeTruthy();
    });
    it('should throw error if plan not found', async () => {
      await expect(storage.removeTasks(999, ['999'])).rejects.toThrow('No plan found for goal 999');
    });

    it('should correctly sort taskIds before removal to ensure proper processing order', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null }); // id: "1"
      const task1_1 = await storage.addTask(goal.id, { title: 'Task 1.1', description: '', parentId: task1.id }); // id: "1.1"
      const task2 = await storage.addTask(goal.id, { title: 'Task 2', description: '', parentId: null }); // id: "2"
      const task1_2 = await storage.addTask(goal.id, { title: 'Task 1.2', description: '', parentId: task1.id }); // id: "1.2"

      // Attempt to remove tasks in an unsorted order
      const taskIdsToRemove = [task1_2.id, task1.id, task2.id, task1_1.id];

      // Mock the internal removeTaskAndSubtasks to verify call order if possible,
      // or simply check the final state after removal.
      // For now, we'll rely on the fact that if the test passes, the sorting worked.
      const result = await storage.removeTasks(goal.id, taskIdsToRemove, true);

      expect(result.removedTasks.length).toBe(4);
      expect(result.removedTasks.map(t => t.id).sort()).toEqual([task1.id, task1_1.id, task1_2.id, task2.id].sort());

      const remainingTasks = await storage.getTasks(goal.id, 'recursive');
      expect(remainingTasks).toHaveLength(0);
    });

    it('should throw error if metadata collection not found when removing tasks', async () => {
      // Create a goal and plan, and some tasks first, before mocking
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null });

      // Temporarily mock getCollection to return null for 'metadata'
      const metadataCollection = (storage as any).db.getCollection('metadata');
      const originalFindOne = metadataCollection.findOne;
      metadataCollection.findOne = vi.fn(() => null);

      await expect(
        storage.removeTasks(goal.id, [task1.id])
      ).rejects.toThrow('Metadata collection not found or empty.');

      // Restore original findOne
      metadataCollection.findOne = originalFindOne;
    });
  });

  describe('getTasks', () => {
    it('should return tasks without subtasks', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null });
      await storage.addTask(goal.id, { title: 'Task 2', description: '', parentId: null });
      const tasks = await storage.getTasks(goal.id, 'none');
      expect(tasks.length).toBe(2);
      expect(tasks[0].id).toBe('1');
      expect(tasks[1].id).toBe('2');
    });

    it('should return tasks with first-level subtasks', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parentTask = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      const subTask = await storage.addTask(goal.id, { title: 'Sub', description: '', parentId: parentTask.id });
      const tasks = await storage.getTasks(goal.id, 'first-level');
      expect(tasks.length).toBe(2);
      expect(tasks.find(t => t.id === parentTask.id)).toBeDefined();
      expect(tasks.find(t => t.id === subTask.id)).toBeDefined();
    });

    it('should return tasks with recursive subtasks', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      await storage.createPlan(goal.id);
      const parent = await storage.addTask(goal.id, { title: 'Parent', description: '', parentId: null });
      const child = await storage.addTask(goal.id, { title: 'Child', description: '', parentId: parent.id });
      const grandchild = await storage.addTask(goal.id, { title: 'Grandchild', description: '', parentId: child.id });
      const tasks = await storage.getTasks(goal.id, 'recursive');
      expect(tasks.length).toBe(3);
      expect(tasks.find(t => t.id === parent.id)).toBeDefined();
      expect(tasks.find(t => t.id === child.id)).toBeDefined();
      expect(tasks.find(t => t.id === grandchild.id)).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('updateParentTaskStatus should update parent if all siblings complete', async () => {
      // Setup: parent exists, all siblings complete, parent not complete
      const goalId = 1;
      const parentId = '10';
      const parentTask = { id: parentId, goalId, parentId: null, isComplete: false, updatedAt: '', $loki: 1, meta: {} };
      const siblingTasks = [
        { id: '11', goalId, parentId, isComplete: true },
        { id: '12', goalId, parentId, isComplete: true },
      ];
      
      // Mock the collection methods
      const mockUpdate = vi.fn();
      (storage as any).tasks = {
        findOne: vi.fn().mockReturnValue(parentTask),
        find: vi.fn().mockReturnValue(siblingTasks),
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

    it('handles recursive subtask updates', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      const plan = await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { 
        title: 'Task 1',
        description: '',
        parentId: null
      });
      const task2 = await storage.addTask(goal.id, { 
        title: 'Task 2',
        description: '',
        parentId: task1.id
      });
      const task3 = await storage.addTask(goal.id, { 
        title: 'Task 3',
        description: '',
        parentId: task2.id
      });
      
      // Try to mark parent task complete when children are not complete
      await storage.completeTasksStatus(goal.id, [task1.id]);
      const tasks = await storage.getTasks(goal.id, 'recursive');
      const updatedTask1 = tasks.find(t => t.id === task1.id);
      const updatedTask2 = tasks.find(t => t.id === task2.id);
      const updatedTask3 = tasks.find(t => t.id === task3.id);
      
      // Parent task should not be complete because children are not complete
      expect(updatedTask1?.isComplete).toBe(false);
      expect(updatedTask2?.isComplete).toBe(false);
      expect(updatedTask3?.isComplete).toBe(false);
      
      // Now complete all children
      await storage.completeTasksStatus(goal.id, [task3.id]);
      await storage.completeTasksStatus(goal.id, [task2.id]);
      
      // Now try to complete parent
      await storage.completeTasksStatus(goal.id, [task1.id]);
      const finalTasks = await storage.getTasks(goal.id, 'recursive');
      const finalTask1 = finalTasks.find(t => t.id === task1.id);
      expect(finalTask1?.isComplete).toBe(true);
    });

    it('handles parent status updates', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      const plan = await storage.createPlan(goal.id);
      const task1 = await storage.addTask(goal.id, { 
        title: 'Task 1',
        description: '',
        parentId: null
      });
      const task2 = await storage.addTask(goal.id, { 
        title: 'Task 2',
        description: '',
        parentId: task1.id
      });
      const task3 = await storage.addTask(goal.id, { 
        title: 'Task 3',
        description: '',
        parentId: task1.id
      });
      await storage.completeTasksStatus(goal.id, [task2.id, task3.id]);
      const tasks = await storage.getTasks(goal.id, 'none');
      const updatedTask1 = tasks.find(t => t.id === task1.id);
      expect(updatedTask1?.isComplete).toBe(true);
    });

    it('completes parent task when pending subtask is deleted and all remaining subtasks are complete', async () => {
      const goal = await storage.createGoal('Test Goal', 'https://github.com/test/repo');
      const plan = await storage.createPlan(goal.id);
      
      // Create a parent task with three subtasks
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
      
      const subtask3 = await storage.addTask(goal.id, { 
        title: 'Subtask 3',
        description: '',
        parentId: parentTask.id
      });

      // Complete two subtasks
      await storage.completeTasksStatus(goal.id, [subtask1.id, subtask2.id]);
      
      // Delete the pending subtask
      const result = await storage.removeTasks(goal.id, [subtask3.id]);
      
      // Verify that the parent task was completed
      expect(result.completedParents).toHaveLength(1);
      expect(result.completedParents[0].id).toBe(parentTask.id);
      expect(result.completedParents[0].isComplete).toBe(true);
    });

    it('should reorder sibling tasks and update their IDs after removal', async () => {
      const goal = await storage.createGoal('Test Goal for Reordering', 'https://github.com/test/reorder');
      await storage.createPlan(goal.id);

      // Add top-level tasks
      const task1 = await storage.addTask(goal.id, { title: 'Task 1', description: '', parentId: null }); // id: "1"
      const task2 = await storage.addTask(goal.id, { title: 'Task 2', description: '', parentId: null }); // id: "2"
      const task3 = await storage.addTask(goal.id, { title: 'Task 3', description: '', parentId: null }); // id: "3"

      // Add subtasks to Task 2 (which will become Task 1 after removal of Task 1)
      const subtask2_1 = await storage.addTask(goal.id, { title: 'Subtask 2.1', description: '', parentId: task2.id }); // id: "2.1"
      const subtask2_2 = await storage.addTask(goal.id, { title: 'Subtask 2.2', description: '', parentId: task2.id }); // id: "2.2"

      // Remove Task 1 (top-level)
      const removeResult1 = await storage.removeTasks(goal.id, [task1.id]);
      expect(removeResult1.removedTasks.length).toBe(1);
      expect(removeResult1.removedTasks[0].id).toBe(task1.id);

      // Verify top-level tasks are reordered: Task 2 should become '1', Task 3 should become '2'
      const topLevelTasksAfterRemoval1 = await storage.getTasks(goal.id, 'none');
      expect(topLevelTasksAfterRemoval1.length).toBe(2);
      expect(topLevelTasksAfterRemoval1[0].id).toBe('1'); // Task 2 reordered to '1'
      expect(topLevelTasksAfterRemoval1[0].title).toBe('Task 2');
      expect(topLevelTasksAfterRemoval1[1].id).toBe('2'); // Task 3 reordered to '2'
      expect(topLevelTasksAfterRemoval1[1].title).toBe('Task 3');

      // Verify subtasks of original Task 2 (now Task 1) have their parentId updated
      // Note: TaskResponse does not include parentId, so we cannot directly assert it.
      // We rely on the fact that the storage logic correctly updates parentIds internally.
      const directChildrenOfNewParentTask1 = await storage.getTasks(goal.id, 'first-level');
      // Filter to ensure we are looking at children of the *new* parent ID '1'
      const childrenOfNewParent = directChildrenOfNewParentTask1.filter(t => t.id.startsWith('1.'));

      expect(childrenOfNewParent.length).toBe(2);
      expect(childrenOfNewParent[0].id).toBe('1.1'); // Original subtask 2.1, now 1.1
      expect(childrenOfNewParent[0].title).toBe('Subtask 2.1');

      expect(childrenOfNewParent[1].id).toBe('1.2'); // Original subtask 2.2, now 1.2
      expect(childrenOfNewParent[1].title).toBe('Subtask 2.2');
    });
  });
});
