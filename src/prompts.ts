export function formatPlanAsTasks(input: string): any[] {
  if (!input.trim()) return [];
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    // Not valid JSON, try to parse as text fallback
    const sections = input.split(/\n\n(?=\d+\.)/);
    const tasks = sections
      .filter(section => /^\d+\.\s/.test(section.trim()))
      .map(section => {
        const lines = section.split('\n');
        const title = lines[0].replace(/^[0-9]+\.\s*/, '').trim();
        // Remove title line from description
        const description = section
          .replace(/^[0-9]+\.\s*[^\n]*\n/, '') // Remove title line
          .trim();
        return {
          title,
          description,
          parentId: undefined
        };
      })
      .filter(task => task.title); // Only keep tasks with a title
    if (!tasks.length) return [];
    return tasks;
  }
}
