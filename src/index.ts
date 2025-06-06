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
import { Goal, Task, TaskResponse, AddTasksInput, HierarchicalTaskResponse, TaskInput } from './types';

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
          description: 'Add multiple tasks to a goal. Tasks can be provided in a hierarchical structure. For tasks that are children of *existing* tasks, use the `parentId` field. The operation is transactional: either all tasks in the batch succeed, or the entire operation fails.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal to add tasks to (number)',
              },
              tasks: {
                type: 'array',
                description: 'An array of task objects to be added. Each task can define nested subtasks.',
                items: {
                  $ref: '#/definitions/TaskInput'
                }
              }
            },
            required: ['goalId', 'tasks'],
            definitions: {
              TaskInput: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'Title of the task (string)'
                  },
                  description: {
                    type: 'string',
                    description: 'Detailed description of the task (string)'
                  },
                  parentId: {
                    type: ['string', 'null'],
                    description: 'Optional parent task ID for tasks that are children of *existing* tasks. Do not use for new subtasks defined hierarchically within this batch.'
                  },
                  subtasks: {
                    type: 'array',
                    description: 'An array of nested subtask objects to be created under this task.',
                    items: {
                      $ref: '#/definitions/TaskInput'
                    }
                  }
                },
                required: ['title', 'description']
              }
            }
          }
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
          description: 'Get tasks for a goal. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1"). When `includeSubtasks` is specified, responses will return hierarchical task objects. Otherwise, simplified task objects without `createdAt`, `updatedAt`, or `parentId` will be returned.',
          inputSchema: {
            type: 'object',
            properties: {
              goalId: {
                type: 'number',
                description: 'ID of the goal to get tasks for (number)',
              },
              taskIds: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Optional: IDs of tasks to fetch (array of strings). If null or empty, all tasks for the goal will be fetched.',
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
          const { goalId, tasks: taskInputs } = request.params.arguments as AddTasksInput;

          const createdTasks: HierarchicalTaskResponse[] = [];

          // Helper function to recursively process tasks
          const processTaskInputRecursively = async (
            taskInput: TaskInput,
            currentGoalId: number,
            parentTaskId: string | null
          ): Promise<HierarchicalTaskResponse> => {
            // Validate parentId if it refers to an existing task
            if (taskInput.parentId !== undefined && taskInput.parentId !== null) {
              // Use getTasks to check for existing parent, passing the parentId as an array
              const existingTasks = await storage.getTasks(currentGoalId, [taskInput.parentId]);
              if (!existingTasks || existingTasks.length === 0) {
                throw new McpError(ErrorCode.InvalidParams, `Parent task with ID "${taskInput.parentId}" not found for goal ${currentGoalId}.`);
              }
            }

            // Add the current task
            const newTask = await storage.addTask(currentGoalId, {
              title: taskInput.title,
              description: taskInput.description,
              parentId: parentTaskId, // Use the parentTaskId from recursion, not taskInput.parentId
              deleted: false,
            });

            const hierarchicalTaskResponse: HierarchicalTaskResponse = {
              id: newTask.id,
              goalId: newTask.goalId,
              title: newTask.title,
              description: newTask.description,
              isComplete: newTask.isComplete,
              deleted: newTask.deleted,
            };

            // Recursively add subtasks
            if (taskInput.subtasks && taskInput.subtasks.length > 0) {
              hierarchicalTaskResponse.subtasks = [];
              for (const subtaskInput of taskInput.subtasks) {
                const subtaskResult = await processTaskInputRecursively(
                  subtaskInput,
                  currentGoalId,
                  newTask.id // New task's ID becomes the parent for its subtasks
                );
                hierarchicalTaskResponse.subtasks.push(subtaskResult);
              }
            }
            return hierarchicalTaskResponse;
          };

          // Process top-level tasks
          for (const taskInput of taskInputs) {
            const createdTask = await processTaskInputRecursively(taskInput, goalId, taskInput.parentId || null);
            createdTasks.push(createdTask);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(createdTasks, null, 2),
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
          const { goalId, taskIds, includeSubtasks = 'none', includeDeletedTasks = false } = request.params.arguments as { 
            goalId: number; 
            taskIds?: string[];
            includeSubtasks?: 'none' | 'first-level' | 'recursive';
            includeDeletedTasks?: boolean;
          };

          // If taskIds are provided, fetch specific tasks. Otherwise, fetch all tasks for the goal.
          const fetchedTasks: TaskResponse[] = await storage.getTasks(goalId, taskIds && taskIds.length > 0 ? taskIds : undefined, includeSubtasks, includeDeletedTasks);
          
          // Map Task objects to TaskResponse objects to match the schema description
          const taskResponses: TaskResponse[] = fetchedTasks.map(task => ({
            id: task.id,
            goalId: task.goalId,
            title: task.title,
            description: task.description,
            isComplete: task.isComplete,
            deleted: task.deleted,
          }));

          const textContent = JSON.stringify(taskResponses, null, 2);
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
