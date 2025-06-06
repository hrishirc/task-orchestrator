export interface Task {
  id: string;
  goalId: number;
  parentId: string | null;  // null for top-level tasks
  title: string;
  description: string;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

export interface TaskResponse {
  id: string;
  goalId: number;
  title: string;
  description: string;
  isComplete: boolean;
  deleted: boolean;
}

export interface Goal {
  id: number;
  repoName: string;
  description: string;
  createdAt: string;
}

export interface ImplementationPlan {
  goalId: number;
  tasks: Task[];
  updatedAt: string;
}

export interface StorageData {
  goals: Record<number, Goal>;
  plans: Record<number, ImplementationPlan>;
  nextGoalId: number; // Reverted to original
  nextTaskId: { [goalId: number]: { [parentId: string]: number } }; // Reverted to original
}

// New interfaces for add_tasks input and output
export interface TaskInput {
  title: string;
  description: string;
  parentId?: string | null; // For linking to existing tasks
  subtasks?: TaskInput[]; // For hierarchical new tasks
}

export interface AddTasksInput {
  goalId: number;
  tasks: TaskInput[];
}

// For recursive output
export interface HierarchicalTaskResponse extends TaskResponse {
  subtasks?: HierarchicalTaskResponse[];
}
