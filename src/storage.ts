import Loki from 'lokijs';
import { Goal, ImplementationPlan, Task, TaskResponse } from './types';
import LokiFsStructuredAdapter from 'lokijs/src/loki-fs-structured-adapter.js';
import path from 'path';
import fs from 'fs';

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

    // Initialize nextTaskId tracking if not present
    if (!this.db.getCollection('metadata')) {
      this.db.addCollection('metadata').insert({ nextTaskId: {} });
    } else {
      const metadata = this.db.getCollection('metadata').findOne({});
      if (!metadata.nextTaskId) {
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

    const parentKey = parentId === null ? 'root' : parentId;
    let nextSequence = (metadata.nextTaskId[parentKey] || 0) + 1;

    // Check for existing tasks with the generated ID to ensure uniqueness after reordering
    let newTaskId: string;
    do {
      newTaskId = parentId === null ? String(nextSequence) : `${parentId}.${nextSequence}`;
      nextSequence++;
    } while (this.tasks.findOne({ goalId, id: newTaskId }));

    // Decrement nextSequence because it was incremented one too many times in the do-while loop
    nextSequence--;

    metadata.nextTaskId[parentKey] = nextSequence;
    metadataCollection.update(metadata);

    const task: Task = {
      id: newTaskId,
      goalId,
      parentId,
      title,
      description,
      isComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

    const childTasks = this.tasks.find({ goalId, parentId });
    const allChildrenComplete = childTasks.every(task => task.isComplete);

    if (allChildrenComplete && !parentTask.isComplete) {
      parentTask.isComplete = true;
      parentTask.updatedAt = new Date().toISOString();
      this.tasks.update(parentTask); // Use update to persist changes
      await this.save();
      const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskResponse } = parentTask;
      return taskResponse;
    } else if (!allChildrenComplete && parentTask.isComplete) {
      // If a child task is marked incomplete, or a new incomplete child is added,
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

    // Remove the tasks and all their subtasks
    const removeTaskAndSubtasks = async (taskId: string) => {
      const task = this.tasks.findOne({ goalId, id: taskId });
      if (!task) return;

      // Add parent to set for status check later
      if (task.parentId !== null) {
        parentsToCheck.add(task.parentId);
      }

      // First remove all subtasks (only if deleteChildren is true, which is checked above)
      const subtasks = this.tasks.find({ goalId, parentId: taskId });
      for (const subtask of subtasks) {
        await removeTaskAndSubtasks(subtask.id);
      }

      // Then remove the task itself
      this.tasks.remove(task);
      const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskData } = task as LokiTask;
      removedTasks.push(taskData);
    };

    for (const taskId of sortedTaskIds) {
      await removeTaskAndSubtasks(taskId);
    }

    // Reorder sibling tasks after removal
    const reorderSiblings = async (goalId: number, parentId: string | null) => {
      const siblings = this.tasks.find({ goalId, parentId }).sort((a, b) => {
        return getTaskSequenceNumber(a.id) - getTaskSequenceNumber(b.id);
      });

      // Create a map for oldId to newId for current level
      const idMap = new Map<string, string>();
      for (let i = 0; i < siblings.length; i++) {
        const currentTask = siblings[i];
        const expectedSequence = i + 1;
        const newIdPrefix = parentId === null ? '' : `${parentId}.`;
        const newId = `${newIdPrefix}${expectedSequence}`;
        idMap.set(currentTask.id, newId);
      }

      // Apply updates and collect children for recursion
      const childrenToRecurse: { oldParentId: string, newParentId: string }[] = [];
      for (const task of siblings) {
        const oldId = task.id;
        const newId = idMap.get(oldId)!;

        if (oldId !== newId) {
          task.id = newId;
          this.tasks.update(task);
        }
        
        // Update direct subtasks' parent IDs based on the new ID
        const directSubtasks = this.tasks.find({ goalId, parentId: oldId });
        for (const subtask of directSubtasks) {
          subtask.parentId = newId;
          this.tasks.update(subtask);
        }
        childrenToRecurse.push({ oldParentId: oldId, newParentId: newId });
      }

      // Recursively reorder children
      for (const childRecurse of childrenToRecurse) {
        const hasChildren = this.tasks.find({ goalId, parentId: childRecurse.newParentId }).length > 0;
        if (hasChildren) {
          await reorderSiblings(goalId, childRecurse.newParentId);
        }
      }
    };

    // Reorder tasks for each affected parent (and root)
    const uniqueParentIds = Array.from(parentsToCheck);
    for (const parentId of uniqueParentIds) {
      await reorderSiblings(goalId, parentId);
    }
    // Also reorder top-level tasks
    await reorderSiblings(goalId, null);

    // After removal and reordering, update nextTaskId in metadata and parent statuses
    const metadataCollection = this.db.getCollection('metadata');
    const metadata = metadataCollection.findOne({});
    if (!metadata) {
      throw new Error('Metadata collection not found or empty.');
    }

    const parentsToUpdateNextId = new Set<string | null>(uniqueParentIds);
    parentsToUpdateNextId.add(null); // Include root for nextTaskId update

    for (const parentId of parentsToUpdateNextId) {
      const parentKey = parentId === null ? 'root' : parentId;
      const currentSiblings = this.tasks.find({ goalId, parentId });
      if (currentSiblings.length > 0) {
        const maxSequence = Math.max(...currentSiblings.map(t => getTaskSequenceNumber(t.id)));
        metadata.nextTaskId[parentKey] = maxSequence;
      } else {
        metadata.nextTaskId[parentKey] = 0; // No children, reset sequence
      }
    }
    metadataCollection.update(metadata);

    // Update parent statuses
    for (const parentId of uniqueParentIds) {
      if (parentId !== null) {
        const parentTask = this.tasks.findOne({ goalId, id: parentId });
        if (parentTask) {
          const childTasks = this.tasks.find({ goalId, parentId });
          // Only check remaining tasks after deletion
          const remainingTasks = childTasks.filter(task => !removedTasks.some(removed => removed.id === task.id));
          const allRemainingComplete = remainingTasks.length > 0 && remainingTasks.every(task => task.isComplete);
          
          if (allRemainingComplete && !parentTask.isComplete) {
            parentTask.isComplete = true;
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
        // Original rule: A task can be completed only if all its sub-tasks (if any) are completed.
        const subtasks = this.tasks.find({ goalId, parentId: taskId });
        const allSubtasksComplete = subtasks.every(sub => sub.isComplete);
        if (!allSubtasksComplete) {
          console.warn(`Task ${taskId} cannot be marked complete because not all its subtasks are complete.`);
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
    includeSubtasks: 'none' | 'first-level' | 'recursive' = 'none'
  ): Promise<TaskResponse[]> {
    const allTasksForGoal = this.tasks.find({ goalId });

    const mapToTaskResponse = (task: LokiTask): TaskResponse => {
      const { createdAt, updatedAt, parentId: _, $loki, meta, ...taskResponse } = task as LokiTask;
      return taskResponse;
    };

    if (includeSubtasks === 'recursive') {
      // If recursive, return all tasks for the goal
      return allTasksForGoal.map(mapToTaskResponse);
    }

    const topLevelTasks = allTasksForGoal.filter(task => task.parentId === null)
                                         .map(mapToTaskResponse)
                                         .sort((a, b) => getTaskSequenceNumber(a.id) - getTaskSequenceNumber(b.id));

    if (includeSubtasks === 'none') {
      return topLevelTasks;
    }

    // If 'first-level', get top-level tasks and their direct children
    const resultTasks: TaskResponse[] = [];
    for (const task of topLevelTasks) {
      resultTasks.push(task);
      const directChildren = allTasksForGoal.filter(child => child.parentId === task.id)
                                            .map(mapToTaskResponse)
                                            .sort((a, b) => getTaskSequenceNumber(a.id) - getTaskSequenceNumber(b.id));
      resultTasks.push(...directChildren);
    }

    return resultTasks;
  }
}

export const storage = new Storage();
