import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../storage.js';
import path from 'path';
import fs from 'fs';

describe('Storage File I/O', () => {
  let storage: Storage;
  const dbPath = path.join(__dirname, 'files', 'test_storage_io.db');

  beforeEach(() => {
    // Ensure the directory exists before creating the storage
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    storage = new Storage(dbPath);
  });

  afterEach(async () => {
    // Ensure the database is closed before attempting to delete the file
    // This is crucial for LokiJS to release the file lock
    if ((storage as any).db && (storage as any).db.close) {
      await new Promise<void>((resolve, reject) => {
        (storage as any).db.close((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Clean up all files related to the test database
    const dir = path.dirname(dbPath);
    const baseName = path.basename(dbPath);
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        if (file.startsWith(baseName)) {
          fs.unlinkSync(path.join(dir, file));
        }
      });
    }
  });

  it('should successfully initialize and persist data to a file', async () => {
    await storage.initialize();
    
    const description = 'Test goal for file I/O';
    const repoName = 'https://github.com/file-io/repo';
    const goal = await storage.createGoal(description, repoName);

    expect(goal).toBeDefined();
    expect(goal.description).toBe(description);
    expect(goal.repoName).toBe(repoName);

    // Ensure the database is saved
    await new Promise<void>((resolve, reject) => {
      (storage as any).db.saveDatabase((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Close the first storage instance to release the file lock
    await new Promise<void>((resolve, reject) => {
      (storage as any).db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Create a new storage instance to load from the same file
    const newStorage = new Storage(dbPath);
    await newStorage.initialize(); // Initialize the new instance, loading data

    const retrievedGoal = await newStorage.getGoal(goal.id);
    
    // Compare only the relevant fields, ignoring LokiJS metadata
    expect(retrievedGoal).toMatchObject({
      id: goal.id,
      description: goal.description,
      repoName: goal.repoName,
      createdAt: goal.createdAt
    });

    // Assign newStorage to storage for afterEach cleanup
    storage = newStorage;
  });
});
