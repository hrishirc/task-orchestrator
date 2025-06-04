export interface Task {
  id: string;
  goalId: number;
  parentId: string | null;  // null for top-level tasks
  title: string;
  description: string;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskResponse {
  id: string;
  goalId: number;
  title: string;
  description: string;
  isComplete: boolean;
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
  nextGoalId: number;
  nextTaskId: Record<string, number>;  // Maps parentId (or 'root' for top-level) to next sequence number
}
