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
          description: 'Add multiple tasks to a goal. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1") where each segment represents a level in the hierarchy. The parentId for a subtask is derived from its ID by removing the last segment (e.g., "1.1" is parent of "1.1.1"). Top-level tasks have a null parentId. Responses will return simplified task objects without `createdAt`, `updatedAt`, or `parentId`.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal to add tasks to (number)',
              },
              tasks: {
                type: 'array',
                description: 'An array of new task objects to be added. Each task object must include "title" (string) and "description" (string), and can optionally include "parentId" (string) to define subtasks. Note: The returned task objects will not include `createdAt`, `updatedAt`, or `parentId`.',
                items: {
                  type: 'object',
                  description: 'A single task object. It has the following properties: "title" (string), "description" (string), and optionally "parentId" (string) for subtasks. The `parentId` should be the ID of an existing task. If `parentId` is null, it will be a top-level task.',
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
                      description: 'Optional parent task ID for subtasks (string). Use null for top-level tasks. Example: "1" for a top-level task, "1.1" for a subtask of "1".',
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
          description: 'Remove multiple tasks from a goal. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1"). Responses will return simplified task objects without `createdAt`, `updatedAt`, or `parentId`.',
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
          const currentBatchTitleToIdMap = new Map<string, string>();

          const existingTasks = await storage.getTasks(goalId, 'recursive');
          const existingTitleToIdMap = new Map<string, string>();
          existingTasks.forEach(task => existingTitleToIdMap.set(task.title, task.id));

          for (const task of tasks) {
            let resolvedParentId: string | null = null;
            if (task.parentId) {
              resolvedParentId = currentBatchTitleToIdMap.get(task.parentId) ?? null;
              if (!resolvedParentId) {
                resolvedParentId = existingTitleToIdMap.get(task.parentId) ?? null;
              }
            }

            const newTask = await storage.addTask(goalId, {
              ...task,
              parentId: resolvedParentId
            });
            addedTasks.push(newTask);
            currentBatchTitleToIdMap.set(newTask.title, newTask.id);
          }

          await storage.initialize();
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
              } as { type: 'text'; text: string },
            ],
          };
        }

        case 'get_tasks': {
          const { goalId, includeSubtasks = 'none' } = request.params.arguments as { 
            goalId: number; 
            includeSubtasks?: 'none' | 'first-level' | 'recursive';
          };
          await storage.initialize();
          const tasks = await storage.getTasks(goalId, includeSubtasks);
          const textContent = JSON.stringify(tasks, null, 2);
          return {
            content: [
              {
                type: 'text',
                text: textContent,
              } as { type: 'text'; text: string },
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
