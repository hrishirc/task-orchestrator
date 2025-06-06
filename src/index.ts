#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Request,
} from '@modelcontextprotocol/sdk/types.js';
import { storage } from './storage';
import { Goal, Task, TaskResponse } from './types';

export class SoftwarePlanningServer {
  private server: Server;
  private currentGoal: Goal | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'software-planning-tool',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
  }


  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_goal',
          description: 'Create a new goal',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'The software development goal description (string)',
              },
              repoName: {
                type: 'string',
                description: 'The repository name associated with this goal (string)',
              },
            },
            required: ['description', 'repoName'],
          },
        },
        {
          name: 'add_tasks',
          description: 'Add multiple tasks to a goal. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1") where each segment represents a level in the hierarchy. Top-level tasks have a null parentId. The `parentId` for a subtask must refer to the ID of an *already existing* task. In-batch parent task ID resolution is not supported. Responses will return simplified task objects without `createdAt`, `updatedAt`, or `parentId`.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal to add tasks to (number)',
              },
              tasks: {
                type: 'array',
                description: 'An array of new task objects to be added. Each task object must include "title" (string) and "description" (string), and can optionally include "parentId" (string) to define subtasks. The `parentId` must be the ID of an *already existing* task. If `parentId` is null, it will be a top-level task.',
                items: {
                  type: 'object',
                  description: 'A single task object. It has the following properties: "title" (string), "description" (string), and optionally "parentId" (string) for subtasks.',
                  properties: {
                    title: {
                      type: 'string',
                      description: 'Title of the task (string)',
                    },
                    description: {
                      type: 'string',
                      description: 'Detailed description of the task (string)',
                    },
                    parentId: {
                      type: ['string', 'null'],
                      description: 'Optional parent task ID for subtasks (string). Use null for top-level tasks. Must be the ID of an *already existing* task.',
                    },
                  },
                  required: ['title', 'description'],
                },
              },
            },
            required: ['goalId', 'tasks'],
          },
        },
        {
          name: 'remove_tasks',
          description: 'Soft-delete multiple tasks from a goal. Tasks are marked as deleted but remain in the system. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1"). Responses will return simplified task objects without `createdAt`, `updatedAt`, or `parentId`. Soft-deleted tasks are excluded by default from `get_tasks` results unless `includeDeletedTasks` is set to true.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal to remove tasks from (number)',
              },
              taskIds: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'IDs of the tasks to remove (array of strings). Example: ["1", "1.1"].',
              },
              deleteChildren: {
                type: 'boolean',
                description: 'Whether to delete child tasks along with the parent (boolean). Defaults to false. If false, attempting to delete a parent task with existing subtasks will throw an error.',
                default: false,
              },
            },
            required: ['goalId', 'taskIds'],
          },
        },
        {
          name: 'get_tasks',
          description: 'Get tasks for a goal. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1"). Responses will return simplified task objects without `createdAt`, `updatedAt`, or `parentId`.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal to get tasks for (number)',
              },
              includeSubtasks: {
                type: 'string',
                description: 'Level of subtasks to include: "none" (only top-level tasks), "first-level" (top-level tasks and their direct children), or "recursive" (all nested subtasks). Defaults to "none".',
                enum: ['none', 'first-level', 'recursive'],
                default: 'none',
              },
              includeDeletedTasks: {
                type: 'boolean',
                description: 'Whether to include soft-deleted tasks in the results (boolean). Defaults to false.',
                default: false,
              },
            },
            required: ['goalId'],
          },
        },
        {
          name: 'complete_task_status',
          description: 'Update the completion status of tasks. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1"). Responses will return simplified task objects without `createdAt`, `updatedAt`, or `parentId`.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal containing the tasks (number)',
              },
              taskIds: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'IDs of the tasks to update (array of strings). Example: ["1.1", "1.2"].',
              },
              completeChildren: {
                type: 'boolean',
                description: 'Whether to complete all child tasks recursively (boolean). Defaults to false. If false, a task can only be completed if all its subtasks are already complete.',
                default: false,
              },
            },
            required: ['goalId', 'taskIds'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: Request) => {
      if (!request.params) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing request parameters');
      }

      switch (request.params.name) {
        case 'create_goal': {
          const { description, repoName } = request.params.arguments as { description: string; repoName: string };
          const goal = await storage.createGoal(description, repoName);
          this.currentGoal = goal;
          await storage.createPlan(goal.id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ goalId: goal.id }),
              },
            ],
          };
        }

        case 'add_tasks': {
          const { goalId, tasks } = request.params.arguments as {
            goalId: number;
            tasks: Array<Omit<Task, 'id' | 'goalId' | 'isComplete' | 'createdAt' | 'updatedAt'>>;
          };

          const addedTasks: TaskResponse[] = [];
          // ParentId must refer to an already existing task in the database.
          // In-batch parentId resolution is not supported with the current input schema.

          const existingTasks = await storage.getTasks(goalId, 'recursive', true);
          const existingIdSet = new Set<string>(existingTasks.map(t => t.id));

          for (const task of tasks) {
            let resolvedParentId: string | null = null;
            if (task.parentId !== null) {
              if (existingIdSet.has(task.parentId)) {
                resolvedParentId = task.parentId;
              } else {
                throw new McpError(ErrorCode.InvalidParams, `Parent task with ID "${task.parentId}" not found.`);
              }
            }

            const newTask = await storage.addTask(goalId, {
              title: task.title,
              description: task.description,
              parentId: resolvedParentId,
              // The 'deleted' property is required by the Omit<Task, ...> type in storage.addTask
              deleted: false, 
            });
            addedTasks.push(newTask);
          }

          // No need to call storage.initialize() here, it's done in the constructor/start
          const allTasksInDb = await storage.getTasks(goalId, 'recursive');
          const totalTasksInDb = allTasksInDb.length;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ addedTasks, totalTasksInDb }, null, 2),
              },
            ],
          };
        }

        case 'remove_tasks': {
          const { goalId, taskIds, deleteChildren } = request.params.arguments as { goalId: number; taskIds: string[]; deleteChildren?: boolean };
          const results = await storage.removeTasks(goalId, taskIds, deleteChildren);

          const textContent = JSON.stringify(results, null, 2);
          return {
            content: [
              {
                type: 'text',
                text: textContent,
              },
            ],
          };
        }

        case 'get_tasks': {
          const { goalId, includeSubtasks = 'none', includeDeletedTasks = false } = request.params.arguments as { 
            goalId: number; 
            includeSubtasks?: 'none' | 'first-level' | 'recursive';
            includeDeletedTasks?: boolean;
          };
          // No need to call storage.initialize() here
          const tasks = await storage.getTasks(goalId, includeSubtasks, includeDeletedTasks);
          const textContent = JSON.stringify(tasks, null, 2);
          return {
            content: [
              {
                type: 'text',
                text: textContent,
              },
            ],
          };
        }

        case 'complete_task_status': {
          const { goalId, taskIds, completeChildren } = request.params.arguments as {
            goalId: number;
            taskIds: string[];
            completeChildren?: boolean;
          };
          const results = await storage.completeTasksStatus(goalId, taskIds, completeChildren);
          const textContent = JSON.stringify(results, null, 2);
          return {
            content: [
              {
                type: 'text',
                text: textContent,
              } as { type: 'text'; text: string },
            ],
          };
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async start() {
    await storage.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Software Planning MCP server running on stdio');
  }
}

const server = new SoftwarePlanningServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
