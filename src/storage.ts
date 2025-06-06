import Loki from 'lokijs';
import { Goal, ImplementationPlan, Task, TaskResponse } from './types';
import LokiFsStructuredAdapter from 'lokijs/src/loki-fs-structured-adapter.js';
import path from 'path';
import fs from 'fs';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Type declaration for LokiJS adapter
declare class LokiObj {
  $loki: number;
  meta: {
    created: number;
    revision: number;
    updated: number;
    version: number;
  };
}

type LokiTask = Task & LokiObj;
type LokiGoal = Goal & LokiObj;
type LokiPlan = ImplementationPlan & LokiObj;

// Helper to get the numerical part of a task ID
function getTaskSequenceNumber(taskId: string): number {
  const parts = taskId.split('.');
  return parseInt(parts[parts.length - 1], 10);
}

// Helper to get the parent ID string from a task ID
export function getParentIdFromTaskId(taskId: string): string | null {
  const parts = taskId.split('.');
  if (parts.length === 1) {
    return null; // Top-level task
  }
  return parts.slice(0, parts.length - 1).join('.');
}

export class Storage {
  private db: Loki;
  private goals!: Collection<LokiGoal>;
  private plans!: Collection<LokiPlan>;
  private tasks!: Collection<LokiTask>;

  constructor(dbPath?: string, adapter?: any) {
    // Determine the base path for the database.
    // If dbPath is provided, use it.
    // Otherwise, check MCP_DB_PATH environment variable.
    // As a fallback, use the directory derived from the executing script's path.
    // Go up two directories from the script, then into a 'files' directory.
    const baseDir = path.dirname(path.dirname(process.argv[1]));
    const defaultDbPath = path.join(baseDir, 'files', 'software-planning.db');
    const finalDbPath = dbPath || process.env.MCP_DB_PATH || defaultDbPath;

    // Ensure the directory for the database file exists
    const dbDir = path.dirname(finalDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Loki(finalDbPath, {
      adapter: adapter || new LokiFsStructuredAdapter(),
    });
    // Do not create collections here; do it in initialize()
  }

  async initialize(): Promise<void> {
    // Load the database
    await new Promise<void>((resolve, reject) => {
      this.db.loadDatabase({}, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    // Get or create collections
    this.goals = this.db.getCollection('goals') || this.db.addCollection('goals', { indices: ['id'] });
    this.plans = this.db.getCollection('plans') || this.db.addCollection('plans', { indices: ['goalId'] });
    this.tasks = this.db.getCollection('tasks') || this.db.addCollection('tasks', { indices: ['id', 'goalId', 'parentId'] });

    // Initialize nextTaskId tracking if not present, or ensure it's in the correct structure
    if (!this.db.getCollection('metadata')) {
      this.db.addCollection('metadata').insert({ nextTaskId: {} }); // Initialize with an empty object for goal-scoped task IDs
    } else {
      const metadata = this.db.getCollection('metadata').findOne({});
      // Ensure nextTaskId exists and is an object, if not, reinitialize it
      if (!metadata.nextTaskId || typeof metadata.nextTaskId !== 'object' || Array.isArray(metadata.nextTaskId)) {
        metadata.nextTaskId = {};
        this.db.getCollection('metadata').update(metadata);
      }
    }
  }

  private async save(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db.saveDatabase((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async createGoal(description: string, repoName: string): Promise<Goal> {
    const goal: Goal = {
      id: this.goals.count() + 1,
      repoName,
      description,
      createdAt: new Date().toISOString(),
    };

    this.goals.insert(goal as LokiGoal);

    // Initialize nextTaskId for the new goal
    const metadataCollection = this.db.getCollection('metadata');
    const metadata = metadataCollection.findOne({});
    if (metadata) {
      if (!metadata.nextTaskId) {
        metadata.nextTaskId = {};
      }
      metadata.nextTaskId[goal.id] = { root: 0 }; // Initialize root counter for the new goal
      metadataCollection.update(metadata);
    }

    await this.save();
    const { $loki, meta, ...goalResponse } = goal as LokiGoal;
    return goalResponse;
  }

  async getGoal(id: number): Promise<Goal | null> {
    const goal = this.goals.findOne({ id });
    if (!goal) return null;
    const { $loki, meta, ...goalResponse } = goal as LokiGoal;
    return goalResponse;
  }

  async createPlan(goalId: number): Promise<ImplementationPlan> {
    const plan: ImplementationPlan = {
      goalId,
      tasks: [],
      updatedAt: new Date().toISOString(),
    };

    this.plans.insert(plan as LokiPlan);
    await this.save();
    return plan;
  }

  async getPlan(goalId: number): Promise<ImplementationPlan | null> {
    const plan = this.plans.findOne({ goalId });
    return plan ? { ...plan } : null;
  }

  async addTask(
    goalId: number,
    { title, description, parentId }: Omit<Task, 'id' | 'goalId' | 'isComplete' | 'createdAt' | 'updatedAt'>
  ): Promise<TaskResponse> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const metadataCollection = this.db.getCollection('metadata');
    const metadata = metadataCollection.findOne({});
    if (!metadata) {
      throw new Error('Metadata collection not found or empty.');
    }

    // Ensure nextTaskId for this goal exists
    if (!metadata.nextTaskId[goalId]) {
      metadata.nextTaskId[goalId] = { root: 0 }; // Initialize if not present
    }

    let effectiveParentId: string | null = parentId;
    if (parentId !== null) {
      const existingParent = this.tasks.findOne({ goalId, id: parentId });
      if (!existingParent) {
        throw new McpError(ErrorCode.InvalidParams, `Parent task with ID "${parentId}" not found for goal ${goalId}.`);
      }
    }

    const parentKey = effectiveParentId === null ? 'root' : effectiveParentId;
    const nextSequence = (metadata.nextTaskId[goalId][parentKey] || 0) + 1;
    const newTaskId = effectiveParentId === null ? String(nextSequence) : `${effectiveParentId}.${nextSequence}`;

    metadata.nextTaskId[goalId][parentKey] = nextSequence;
    metadataCollection.update(metadata);

    const task: Task = {
      id: newTaskId,
      goalId,
      parentId: effectiveParentId, // Use effectiveParentId here
      title,
      description,
      isComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false, // Initialize as not deleted
    };

    this.tasks.insert(task as LokiTask);
    plan.updatedAt = new Date().toISOString();
    await this.save();
    const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskResponse } = task as LokiTask;
    return taskResponse;
  }

  private async updateParentTaskStatus(goalId: number, parentId: string | null): Promise<TaskResponse | null> {
    if (parentId === null) return null; // Top-level tasks don't have a parent to update

    const parentTask = this.tasks.findOne({ goalId, id: parentId });
    if (!parentTask) return null;

    // Only consider non-deleted child tasks for parent completion status
    const childTasks = this.tasks.find({ goalId, parentId, deleted: false });
    const allChildrenComplete = childTasks.length > 0 && childTasks.every(task => task.isComplete);

    if (allChildrenComplete && !parentTask.isComplete) {
      parentTask.isComplete = true;
      parentTask.updatedAt = new Date().toISOString();
      this.tasks.update(parentTask); // Use update to persist changes
      await this.save();
      const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskResponse } = parentTask;
      return taskResponse;
    } else if (!allChildrenComplete && parentTask.isComplete) {
      // If a non-deleted child task is marked incomplete, or a new incomplete non-deleted child is added,
      // the parent should also become incomplete.
      parentTask.isComplete = false;
      parentTask.updatedAt = new Date().toISOString();
      this.tasks.update(parentTask);
      await this.save();
      const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskResponse } = parentTask;
      return taskResponse;
    }

    return null;
  }

  async removeTasks(
    goalId: number,
    taskIds: string[],
    deleteChildren: boolean = false // New parameter
  ): Promise<{ removedTasks: TaskResponse[]; completedParents: TaskResponse[] }> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const removedTasks: TaskResponse[] = [];
    const completedParents: TaskResponse[] = [];
    const parentsToCheck: Set<string | null> = new Set();

    // Sort taskIds to ensure parent tasks are processed before their subtasks
    const sortedTaskIds = taskIds.sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        if (aParts[i] !== bParts[i]) {
          return aParts[i] - bParts[i];
        }
      }
      return aParts.length - bParts.length;
    });

    // Validate if deletion is allowed based on deleteChildren flag
    for (const taskId of sortedTaskIds) {
      const task = this.tasks.findOne({ goalId, id: taskId });
      if (!task) continue;

      const subtasks = this.tasks.find({ goalId, parentId: taskId });
      if (subtasks.length > 0 && !deleteChildren) {
        throw new Error(`Task ${taskId} has subtasks and cannot be deleted without explicitly setting 'deleteChildren' to true.`);
      }
    }

    // Soft delete the tasks and all their subtasks
    const softDeleteTaskAndSubtasks = async (taskId: string) => {
      const task = this.tasks.findOne({ goalId, id: taskId });
      if (!task) return;

      // Add parent to set for status check later
      if (task.parentId !== null) {
        parentsToCheck.add(task.parentId);
      }

      // First soft delete all subtasks (only if deleteChildren is true, which is checked above)
      const subtasks = this.tasks.find({ goalId, parentId: taskId });
      for (const subtask of subtasks) {
        await softDeleteTaskAndSubtasks(subtask.id);
      }

      // Then soft delete the task itself
      if (!task.deleted) {
        task.deleted = true;
        task.updatedAt = new Date().toISOString();
        this.tasks.update(task);
        const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskData } = task as LokiTask;
        removedTasks.push(taskData);
      }
    };

    for (const taskId of sortedTaskIds) {
      await softDeleteTaskAndSubtasks(taskId);
    }

    // Update parent statuses
    for (const parentId of parentsToCheck) {
      if (parentId !== null) {
        const parentTask = this.tasks.findOne({ goalId, id: parentId });
        if (parentTask) {
          // Only consider non-deleted child tasks for parent completion status
          const childTasks = this.tasks.find({ goalId, parentId, deleted: false });
          const allChildrenComplete = childTasks.length > 0 && childTasks.every(task => task.isComplete);
          
          if (allChildrenComplete && !parentTask.isComplete) {
            parentTask.isComplete = true;
            parentTask.updatedAt = new Date().toISOString();
            this.tasks.update(parentTask);
            const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskData } = parentTask as LokiTask;
            completedParents.push(taskData);
          } else if (!allChildrenComplete && parentTask.isComplete) {
            // If a non-deleted child task is marked incomplete, or a new incomplete non-deleted child is added,
            // the parent should also become incomplete.
            parentTask.isComplete = false;
            parentTask.updatedAt = new Date().toISOString();
            this.tasks.update(parentTask);
            const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskData } = parentTask as LokiTask;
            completedParents.push(taskData);
          }
        }
      }
    }

    plan.updatedAt = new Date().toISOString();
    await this.save();
    return { removedTasks, completedParents };
  }

  async completeTasksStatus(
    goalId: number,
    taskIds: string[],
    completeChildren: boolean = false
  ): Promise<{ updatedTasks: TaskResponse[]; completedParents: TaskResponse[] }> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const updatedTasks: TaskResponse[] = [];
    const completedParents: TaskResponse[] = [];
    const parentsToCheck: Set<string | null> = new Set();

    const completeTaskAndChildren = async (taskId: string) => {
      const task = this.tasks.findOne({ goalId, id: taskId });
      if (!task) return;

      // If completeChildren is true, mark all subtasks as complete first
      if (completeChildren) {
        const subtasks = this.tasks.find({ goalId, parentId: taskId });
        for (const subtask of subtasks) {
          await completeTaskAndChildren(subtask.id); // Recursively complete children
        }
      } else {
        // A task can be completed only if all its non-deleted sub-tasks (if any) are completed.
        const subtasks = this.tasks.find({ goalId, parentId: taskId, deleted: false });
        const allSubtasksComplete = subtasks.every(sub => sub.isComplete);
        if (!allSubtasksComplete) {
          console.warn(`Task ${taskId} cannot be marked complete because not all its non-deleted subtasks are complete.`);
          return; // Do not mark this task as complete
        }
      }

      // Only update if status is changing to complete
      if (!task.isComplete) {
        task.isComplete = true;
        task.updatedAt = new Date().toISOString();
        this.tasks.update(task);
        const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskData } = task as LokiTask;
        updatedTasks.push(taskData);
      }

      // Add parent to set for status check later
      if (task.parentId !== null) {
        parentsToCheck.add(task.parentId);
      }
    };

    for (const taskId of taskIds) {
      await completeTaskAndChildren(taskId);
    }

    // After updating tasks, check and update parent statuses
    for (const parentId of parentsToCheck) {
      const completedParent = await this.updateParentTaskStatus(goalId, parentId);
      if (completedParent) {
        completedParents.push(completedParent);
      }
    }

    plan.updatedAt = new Date().toISOString();
    await this.save();
    return { updatedTasks, completedParents };
  }

  async getTasks(
    goalId: number,
    taskIds?: string[],
    includeSubtasks: 'none' | 'first-level' | 'recursive' = 'none',
    includeDeletedTasks: boolean = false
  ): Promise<TaskResponse[]> {
    let tasksToConsider = this.tasks.find({ goalId });

    // Filter out deleted tasks unless explicitly requested
    if (!includeDeletedTasks) {
      tasksToConsider = tasksToConsider.filter(task => !task.deleted);
    }

    let resultTasks: LokiTask[] = [];

    if (taskIds && taskIds.length > 0) {
      // If specific taskIds are provided, start with those tasks
      const initialTasks = tasksToConsider.filter(task => taskIds.includes(task.id));
      resultTasks.push(...initialTasks);

      if (includeSubtasks === 'first-level') {
        // Add direct children of the initial tasks
        for (const task of initialTasks) {
          const directChildren = tasksToConsider.filter(child => child.parentId === task.id);
          resultTasks.push(...directChildren);
        }
      } else if (includeSubtasks === 'recursive') {
        // Add all recursive children of the initial tasks
        const addRecursiveChildren = (parentTaskId: string) => {
          const children = tasksToConsider.filter(child => child.parentId === parentTaskId);
          for (const child of children) {
            resultTasks.push(child);
            addRecursiveChildren(child.id);
          }
        };
        for (const task of initialTasks) {
          addRecursiveChildren(task.id);
        }
      }
    } else {
      // If no specific taskIds are provided, fetch tasks based on includeSubtasks
      if (includeSubtasks === 'none') {
        resultTasks = tasksToConsider.filter(task => task.parentId === null);
      } else if (includeSubtasks === 'first-level') {
        const topLevelTasks = tasksToConsider.filter(task => task.parentId === null);
        resultTasks.push(...topLevelTasks);
        for (const task of topLevelTasks) {
          const directChildren = tasksToConsider.filter(child => child.parentId === task.id);
          resultTasks.push(...directChildren);
        }
      } else if (includeSubtasks === 'recursive') {
        // For recursive and no specific taskIds, return all tasks (already filtered by deleted status)
        resultTasks = tasksToConsider;
      }
    }

    // Remove duplicates and sort
    const uniqueResultTasks = Array.from(new Set(resultTasks));
    
    // Sort based on task ID structure
    uniqueResultTasks.sort((a, b) => {
      const aParts = a.id.split('.').map(Number);
      const bParts = b.id.split('.').map(Number);

      for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        if (aParts[i] !== bParts[i]) {
          return aParts[i] - bParts[i];
        }
      }
      return aParts.length - bParts.length;
    });

    const mapToTaskResponse = (task: LokiTask): TaskResponse => {
      const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskResponse } = task as LokiTask;
      return taskResponse;
    };

    return uniqueResultTasks.map(mapToTaskResponse);
  }
}

export const storage = new Storage();
