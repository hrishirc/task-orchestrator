# Task Orchestrator

A Model Context Protocol (MCP) server for task orchestration and management. This tool helps break down goals into manageable tasks and track their progress.

## How to use

Ideally, the LLM should be able to understand when this MCP tool should be used. But as a sample prompt, something like this can possibly work

"Create a new development goal for me. The goal is to 'Implement user authentication' and it's for the 'my-web-app' repository."

LEMME KNOW of any issues you face in the 'discussions' tab

## Features

- Create and manage goals
- Break down goals into hierarchical tasks
- Track task completion status
- Support for subtasks and dependency management between parent task and subtasks
- Persistent storage using LokiDB

## Roadmap 
- Complex task/goal inter-dependency orchestration
- Goal deletion
- Completion dispositions
- UI for visualization of progress

## API Reference

### Task ID Naming Convention

Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1") where each segment represents a level in the hierarchy.
- For each new goal, top-level task IDs start with "1" and increment sequentially (e.g., "1", "2", "3").
- Subtasks have IDs formed by appending a new segment to their parent's ID (e.g., "1.1" is a subtask of "1").
- The combination of `goalId` and `taskId` is guaranteed to be unique.

### Tools

The server provides the following tools (based on `build/index.js`):

1. `create_goal`
   - Create a new goal
   - Parameters:
     ```typescript
     {
       description: string;  // The goal description
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
   - Add multiple tasks to a goal. Tasks can be provided in a hierarchical structure. For tasks that are children of *existing* tasks, use the `parentId` field. The operation is transactional: either all tasks in the batch succeed, or the entire operation fails.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal to add tasks to (number)
       tasks: Array<{
         title: string; // Title of the task (string)
         description: string; // Detailed description of the task (string)
         parentId?: string | null; // Optional parent task ID for tasks that are children of *existing* tasks. Do not use for new subtasks defined hierarchically within this batch.
         subtasks?: Array<any>; // An array of nested subtask objects to be created under this task.
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
           "description": "Define tables for users, roles, and permissions",
           "subtasks": [
             {
               "title": "Create ERD",
               "description": "Draw entity-relationship diagram"
             }
           ]
         },
         {
           "title": "Implement user registration",
           "description": "Create API endpoint for new user signup",
           "parentId": "1"
         }
       ]
     }
     ```
   - Returns: `HierarchicalTaskResponse[]`. `HierarchicalTaskResponse` objects are simplified and do not include `createdAt`, `updatedAt`, or `parentId`.

3. `remove_tasks`
   - Soft-delete multiple tasks from a goal. Tasks are marked as deleted but remain in the system. By default, a parent task with subtasks cannot be soft-deleted without explicitly deleting its children. Soft-deleted tasks are excluded by default from `get_tasks` results unless `includeDeletedTasks` is set to true.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal to remove tasks from
       taskIds: string[]; // IDs of the tasks to remove (array of strings). Task IDs use dot-notation (e.g., "1", "1.1").
       deleteChildren?: boolean; // Whether to delete child tasks along with the parent (boolean). Defaults to false. If false, attempting to delete a parent task with existing subtasks will throw an error.
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
   - Get tasks for a goal. Task IDs use a dot-notation (e.g., "1", "1.1", "1.1.1"). When `includeSubtasks` is specified, responses will return hierarchical task objects. Otherwise, simplified task objects without `createdAt`, `updatedAt`, or `parentId` will be returned.
   - Parameters:
     ```typescript
     {
       goalId: number; // ID of the goal to get tasks for (number)
       taskIds?: string[]; // Optional: IDs of tasks to fetch (array of strings). If null or empty, all tasks for the goal will be fetched.
       includeSubtasks?: "none" | "first-level" | "recursive"; // Level of subtasks to include: "none" (only top-level tasks), "first-level" (top-level tasks and their direct children), or "recursive" (all nested subtasks). Defaults to "none".
       includeDeletedTasks?: boolean; // Whether to include soft-deleted tasks in the results (boolean). Defaults to false.
     }
     ```
   - Sample Input:
     ```json
     {
       "goalId": 1,
       "includeSubtasks": "recursive",
       "includeDeletedTasks": true
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
       completeChildren?: boolean; // Whether to complete all child tasks recursively (boolean). Defaults to false. If false, a task can only be completed if all its subtasks are already complete.
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
   - Returns: `TaskResponse[]`. `TaskResponse` objects are simplified and do not include `createdAt`, `updatedAt`, or `parentId`.

## Usage Examples

### Creating a Goal and Tasks

```typescript
// Create a new goal. Its top-level tasks will start with ID "1".
const goal = await callTool('create_goal', {
  description: 'Implement user authentication',
  repoName: 'user/repo'
});

// Add a top-level task
const task1 = await callTool('add_tasks', {
  goalId: goal.goalId,
  tasks: [
    {
      title: 'Set up authentication middleware',
      description: 'Implement JWT-based authentication'
    }
  ]
});
// task1.addedTasks[0].id will be "1"

// Add a subtask to the previously created task "1"
const task2 = await callTool('add_tasks', {
  goalId: goal.goalId,
  tasks: [
    {
      title: 'Create login endpoint',
      description: 'Implement POST /auth/login',
      parentId: "1"  // ParentId must refer to an *already existing* task ID
    }
  ]
});
// task2.addedTasks[0].id will be "1.1"
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
