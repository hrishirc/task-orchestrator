# Task Orchestrator

A Model Context Protocol (MCP) server for software planning and task management. This tool helps break down software development goals into manageable tasks and track their progress.

## Features

- Create and manage software development goals
- Break down goals into hierarchical tasks
- Track task completion status
- Support for task dependencies and subtasks
- Persistent storage using LokiDB

## API Reference

### Resources

The server provides two main resources:

1. `planning://current-goal`
   - Type: `application/json`
   - Contains the active software development goal
   - Example:
   ```jsonc
   {
     "id": 1,
     "description": "Implement user authentication",
     "repoName": "user/repo",
     "createdAt": "2024-03-20T10:00:00Z"
   }
   ```

2. `planning://implementation-plan`
   - Type: `application/json`
   - Contains the task breakdown for the current goal.
   // Note: This resource provides plan metadata. The 'tasks' array here will be empty.
   // Use the 'get_tasks' tool to retrieve the actual task list for the goal.
   - Example:
   ```jsonc
   {
     "goalId": 1,
     "tasks": [], // Tasks array is empty here; use get_tasks tool for actual tasks
     "updatedAt": "2024-03-20T10:00:00Z"
   }
   ```

### Task ID Naming Convention

Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1") where each segment represents a level in the hierarchy.
- Top-level tasks have simple numeric IDs (e.g., "1", "2").
- Subtasks have IDs formed by appending a new segment to their parent's ID (e.g., "1.1" is a subtask of "1").
- The `parentId` for a subtask can be derived from its ID by removing the last segment (e.g., "1.1" is the parent ID for "1.1.1").

### Tools

The server provides the following tools (based on `build/index.js`):

1. `create_goal`
   - Create a new goal
   - Parameters:
     ```typescript
     {
       description: string;  // The software development goal description
       repoName: string;     // The repository name associated with this goal
     }
     ```
   - Sample Input:
     ```json
     {
       "description": "Implement user authentication",
       "repoName": "example/auth-service"
     }
     ```
   - Returns: `{ goalId: number }`

2. `add_tasks`
   - Add multiple tasks to a goal.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal to add tasks to
       tasks: Array<{
         title: string; // Title of the task
         description: string; // Detailed description of the task
         parentId?: string; // Optional parent task ID for subtasks. Use null for top-level tasks. Example: "1" for a top-level task, "1.1" for a subtask of "1".
       }>;
     }
     ```
   - Sample Input:
     ```json
     {
       "goalId": 1,
       "tasks": [
         {
           "title": "Design database schema",
           "description": "Define tables for users, roles, and permissions"
         },
         {
           "title": "Implement user registration",
           "description": "Create API endpoint for new user signup",
           "parentId": "1"
         }
       ]
     }
     ```
   - Returns: `{ addedTasks: TaskResponse[], totalTasksInDb: number }`. `TaskResponse` objects are simplified and do not include `createdAt`, `updatedAt`, or `parentId`.

3. `remove_tasks`
   - Remove multiple tasks from a goal. By default, a parent task with subtasks cannot be removed without explicitly deleting its children.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal to remove tasks from
       taskIds: string[]; // IDs of the tasks to remove (array of strings). Task IDs use dot-notation (e.g., "1", "1.1").
       deleteChildren?: boolean; // Optional: Set to true to recursively delete child tasks along with the parent. Defaults to false.
     }
     ```
   - Sample Input (without deleting children):
     ```json
     {
       "goalId": 1,
       "taskIds": ["2", "3"]
     }
     ```
   - Sample Input (with deleting children):
     ```json
     {
       "goalId": 1,
       "taskIds": ["1"],
       "deleteChildren": true
     }
     ```
   - Returns: `{ removedTasks: TaskResponse[], completedParents: TaskResponse[] }`. `TaskResponse` objects are simplified and do not include `createdAt`, `updatedAt`, or `parentId`.

4. `get_tasks`
   - Get tasks for a goal.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal to get tasks for
       includeSubtasks?: "none" | "first-level" | "recursive"; // Level of subtasks to include: "none" (only top-level tasks), "first-level" (top-level tasks and their direct children), or "recursive" (all nested subtasks). Defaults to "none".
     }
     ```
   - Sample Input:
     ```json
     {
       "goalId": 1,
       "includeSubtasks": "recursive"
     }
     ```
   - Returns: `TaskResponse[]`. `TaskResponse` objects are simplified and do not include `createdAt`, `updatedAt`, or `parentId`.

5. `complete_task_status`
   - Mark tasks as complete. By default, a parent task cannot be marked complete if it has incomplete child tasks.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal containing the tasks
       taskIds: string[]; // IDs of the tasks to update (array of strings). Task IDs use dot-notation (e.g., "1", "1.1").
       completeChildren?: boolean; // Optional: Set to true to recursively complete all child tasks when marking a parent task complete. Defaults to false.
     }
     ```
   - Sample Input (without completing children):
     ```json
     {
       "goalId": 1,
       "taskIds": ["1", "2"]
     }
     ```
   - Sample Input (with completing children):
     ```json
     {
       "goalId": 1,
       "taskIds": ["1"],
       "completeChildren": true
     }
     ```
   - Returns: `{ updatedTasks: TaskResponse[], completedParents: TaskResponse[] }`. `TaskResponse` objects are simplified and do not include `createdAt`, `updatedAt`, or `parentId`.

## Usage Examples

### Creating a Goal and Tasks

```typescript
// Create a new goal
const goal = await callTool('create_goal', {
  description: 'Implement user authentication',
  repoName: 'user/repo'
});

// Add tasks
const tasks = await callTool('add_tasks', {
  goalId: goal.goalId,
  tasks: [
    {
      title: 'Set up authentication middleware',
      description: 'Implement JWT-based authentication'
    },
    {
      title: 'Create login endpoint',
      description: 'Implement POST /auth/login',
      parentId: "1"  // Subtask of the first task
    }
  ]
});
// 'tasks' will be an array of simplified TaskResponse objects.
// Example: [{ id: "1", goalId: 1, title: "Set up authentication middleware", description: "...", isComplete: false }, ...]
```

### Managing Task Status

```typescript
// Mark a parent task as complete, which will also complete its children
await callTool('complete_task_status', {
  goalId: 1,
  taskIds: ["1"],
  completeChildren: true
});

// Get all tasks including subtasks recursively
const allTasks = await callTool('get_tasks', {
  goalId: 1,
  includeSubtasks: "recursive"
});
```

### Removing Tasks

```typescript
// Attempt to remove a parent task without deleting children (will fail if it has subtasks)
try {
  await callTool('remove_tasks', {
    goalId: 1,
    taskIds: ["1"]
  });
} catch (error) {
  console.error(error.message); // Expected to throw an error if subtasks exist
}

// Remove a parent task and its children
await callTool('remove_tasks', {
  goalId: 1,
  taskIds: ["1"],
  deleteChildren: true
});
```

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Build the project:
   ```bash
   pnpm build
   ```

3. Run tests:
   ```bash
   pnpm test
   ```

### Project Structure

- `src/` - Source code
  - `index.ts` - Main server implementation
  - `storage.ts` - Data persistence layer
  - `types.ts` - TypeScript type definitions
  - `prompts.ts` - AI prompt templates
  - `__tests__/` - Test files

## License

MIT
