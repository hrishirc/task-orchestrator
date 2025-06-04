import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SoftwarePlanningServer } from '../index.js';
import { Storage } from '../storage.js';
import { Goal, Task } from '../types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
    onerror: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('../storage.js', () => {
  const mockStorage = {
    initialize: vi.fn(),
    createGoal: vi.fn(),
    getGoal: vi.fn(),
    createPlan: vi.fn(),
    getPlan: vi.fn(),
    addTask: vi.fn(),
    removeTasks: vi.fn(),
    completeTasksStatus: vi.fn(),
    getTasks: vi.fn(),
  };

  return {
    Storage: vi.fn().mockImplementation(() => mockStorage),
    storage: mockStorage,
  };
});

describe('SoftwarePlanningServer', () => {
  let server: SoftwarePlanningServer;
  let mockServer: any;
  let mockStorage: any;
  let listToolsHandler: any;
  let callToolHandler: any;

  beforeEach(() => {
    mockServer = {
      setRequestHandler: vi.fn((schema, handler) => {
        if (schema === ListToolsRequestSchema) {
          listToolsHandler = handler;
        } else if (schema === CallToolRequestSchema) {
          callToolHandler = handler;
        }
      }),
      connect: vi.fn(),
      onerror: vi.fn(),
    };

    (Server as any).mockImplementation(() => mockServer);

    mockStorage = new Storage();
    server = new SoftwarePlanningServer();
    (server as any).storage = mockStorage;
  });


  describe('tool handlers', () => {
    it('should list available tools', async () => {
      const result = await listToolsHandler();
      expect(result.tools).toHaveLength(5);
      expect(result.tools[0].name).toBe('create_goal');
      expect(result.tools[1].name).toBe('add_tasks');
      expect(result.tools[2].name).toBe('remove_tasks');
      expect(result.tools[3].name).toBe('get_tasks');
      expect(result.tools[4].name).toBe('complete_task_status');
    });

    it('should handle create_goal tool', async () => {
      const mockGoal: Goal = {
        id: 1,
        description: 'Test goal',
        repoName: 'https://github.com/test/repo',
        createdAt: new Date().toISOString(),
      };

      mockStorage.createGoal.mockResolvedValue(mockGoal);
      mockStorage.createPlan.mockResolvedValue({
        goalId: 1,
        tasks: [],
        updatedAt: new Date().toISOString(),
      });

      const result = await callToolHandler({
        params: {
          name: 'create_goal',
          arguments: {
            description: 'Test goal',
            repoName: 'https://github.com/test/repo',
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ goalId: 1 }),
          },
        ],
      });
    });

    it('should handle add_tasks tool', async () => {
      const mockTask: Task = {
        id: "1", // Changed to string
        goalId: 1,
        title: 'Test task',
        description: 'Test description',
        parentId: null,
        isComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock getTasks to return an empty array initially, then the added task for totalTasksInDb count
      mockStorage.getTasks.mockResolvedValueOnce([]); 
      mockStorage.addTask.mockResolvedValue(mockTask);
      mockStorage.initialize.mockResolvedValue(undefined); // Mock initialize
      mockStorage.getTasks.mockResolvedValueOnce([mockTask]); // Mock getTasks for totalTasksInDb count

      const result = await callToolHandler({
        params: {
          name: 'add_tasks',
          arguments: {
            goalId: 1,
            tasks: [
              {
                title: 'Test task',
                description: 'Test description',
                parentId: null,
              },
            ],
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ addedTasks: [mockTask], totalTasksInDb: 1 }, null, 2),
          },
        ],
      });
    });

    it('should handle add_tasks tool with parentId referring to a task in the same batch', async () => {
      const mockTask1: Task = {
        id: "1",
        goalId: 1,
        title: 'Parent task',
        description: 'Parent description',
        parentId: null,
        isComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const mockTask2: Task = {
        id: "1.1",
        goalId: 1,
        title: 'Child task',
        description: 'Child description',
        parentId: "1", // Parent ID refers to task 1
        isComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockStorage.getTasks.mockResolvedValueOnce([]); // Initial empty tasks
      mockStorage.addTask
        .mockResolvedValueOnce(mockTask1)
        .mockResolvedValueOnce(mockTask2);
      mockStorage.initialize.mockResolvedValue(undefined);
      mockStorage.getTasks.mockResolvedValueOnce([mockTask1, mockTask2]); // After adding

      const result = await callToolHandler({
        params: {
          name: 'add_tasks',
          arguments: {
            goalId: 1,
            tasks: [
              { title: 'Parent task', description: 'Parent description', parentId: null },
              { title: 'Child task', description: 'Child description', parentId: 'Parent task' }, // Referencing by title
            ],
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ addedTasks: [mockTask1, mockTask2], totalTasksInDb: 2 }, null, 2),
          },
        ],
      });
      expect(mockStorage.addTask).toHaveBeenCalledWith(1, {
        title: 'Parent task',
        description: 'Parent description',
        parentId: null,
      });
      expect(mockStorage.addTask).toHaveBeenCalledWith(1, {
        title: 'Child task',
        description: 'Child description',
        parentId: '1', // Should be resolved to the ID of 'Parent task'
      });
    });

    it('should handle add_tasks tool with parentId referring to an already existing task', async () => {
      const existingTask: Task = {
        id: "10",
        goalId: 1,
        title: 'Existing Parent',
        description: 'Existing parent description',
        parentId: null,
        isComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const newTask: Task = {
        id: "10.1",
        goalId: 1,
        title: 'New Child',
        description: 'New child description',
        parentId: "10",
        isComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockStorage.getTasks.mockResolvedValueOnce([existingTask]); // Simulate existing tasks
      mockStorage.addTask.mockResolvedValueOnce(newTask);
      mockStorage.initialize.mockResolvedValue(undefined);
      mockStorage.getTasks.mockResolvedValueOnce([existingTask, newTask]); // After adding

      const result = await callToolHandler({
        params: {
          name: 'add_tasks',
          arguments: {
            goalId: 1,
            tasks: [
              { title: 'New Child', description: 'New child description', parentId: 'Existing Parent' },
            ],
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ addedTasks: [newTask], totalTasksInDb: 2 }, null, 2),
          },
        ],
      });
      expect(mockStorage.addTask).toHaveBeenCalledWith(1, {
        title: 'New Child',
        description: 'New child description',
        parentId: '10', // Should be resolved to the ID of 'Existing Parent'
      });
    });

    it('should handle add_tasks tool with parentId that does not exist', async () => {
      const newTask: Task = {
        id: "1",
        goalId: 1,
        title: 'Top-level task',
        description: 'Description',
        parentId: null, // Should resolve to null
        isComplete: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockStorage.getTasks.mockResolvedValueOnce([]); // No existing tasks
      mockStorage.addTask.mockResolvedValueOnce(newTask);
      mockStorage.initialize.mockResolvedValue(undefined);
      mockStorage.getTasks.mockResolvedValueOnce([newTask]);

      const result = await callToolHandler({
        params: {
          name: 'add_tasks',
          arguments: {
            goalId: 1,
            tasks: [
              { title: 'Top-level task', description: 'Description', parentId: 'NonExistentParent' },
            ],
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ addedTasks: [newTask], totalTasksInDb: 1 }, null, 2),
          },
        ],
      });
      expect(mockStorage.addTask).toHaveBeenCalledWith(1, {
        title: 'Top-level task',
        description: 'Description',
        parentId: null, // Should be resolved to null
      });
    });

    it('should handle remove_tasks tool', async () => {
      const mockResult = {
        removedTasks: [
          {
            id: "1", // Changed to string
            goalId: 1,
            title: 'Test task',
          },
        ],
        completedParents: [],
      };

      mockStorage.removeTasks.mockResolvedValue(mockResult);

      const result = await callToolHandler({
        params: {
          name: 'remove_tasks',
          arguments: {
            goalId: 1,
            taskIds: ["1"], // Changed to string array
            deleteChildren: true, // Added new parameter
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResult, null, 2),
          },
        ],
      });
    });

    it('should handle get_tasks tool', async () => {
      const mockTasks = [
        {
          id: "1", // Changed to string
          goalId: 1,
          title: 'Test task',
          parentId: null,
        },
      ];

      mockStorage.getTasks.mockResolvedValue(mockTasks);
      mockStorage.initialize.mockResolvedValue(undefined); // Mock initialize

      const result = await callToolHandler({
        params: {
          name: 'get_tasks',
          arguments: {
            goalId: 1,
            includeSubtasks: "recursive", // Changed to string literal
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockTasks, null, 2),
          },
        ],
      });
    });

    it('should handle complete_task_status tool', async () => {
      const mockResult = {
        updatedTasks: [
          {
            id: "1",
            goalId: 1,
            title: 'Test task',
            isComplete: true,
          },
        ],
        completedParents: [],
      };

      mockStorage.completeTasksStatus.mockResolvedValue(mockResult);

      const result = await callToolHandler({
        params: {
          name: 'complete_task_status',
          arguments: {
            goalId: 1,
            taskIds: ["1"],
            completeChildren: true,
          },
        },
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResult, null, 2),
          },
        ],
      });
    });
  });

  describe('tool handlers (errors)', () => {
    it('should throw for unknown tool', async () => {
      await expect(callToolHandler({ params: { name: 'unknown_tool', arguments: {} } })).rejects.toThrow('Unknown tool');
    });
  });

  it('handles server startup errors', async () => {
    const mockServer = {
      listen: vi.fn().mockRejectedValue(new Error('Port in use')),
      close: vi.fn()
    };
    const mockCreateServer = vi.fn().mockReturnValue(mockServer);
    vi.stubGlobal('createServer', mockCreateServer);

    const server = new SoftwarePlanningServer();
    const result = await server.start();
    expect(result).toBeUndefined();
  });
});
