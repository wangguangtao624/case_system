export interface TreeFilters {
  testerId: string;
  archive: string;
}

// A refresh always uses the current filters, even when called by an older
// autosave callback. Only the latest request may publish or return a tree.
export function createTreeLoader<T>(
  onTree: (tree: T[]) => void,
  onManager: (isManager: boolean) => void,
) {
  let filters: TreeFilters = { testerId: '', archive: 'active' };
  let revision = 0;
  let controller: AbortController | undefined;

  const invalidate = () => {
    revision += 1;
    controller?.abort();
    controller = undefined;
  };

  return {
    setFilters(next: Partial<TreeFilters>) {
      const updated = { ...filters, ...next };
      if (updated.testerId === filters.testerId && updated.archive === filters.archive) return;
      filters = updated;
      invalidate();
      // Do not display the previous scope under the new filter label.
      onTree([]);
    },
    dispose: invalidate,
    async load(): Promise<T[] | undefined> {
      invalidate();
      const requestRevision = revision;
      controller = new AbortController();
      try {
        const params = new URLSearchParams({ archive: filters.archive });
        if (filters.testerId) params.set('testerId', filters.testerId);
        const response = await fetch(`/api/tree?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Load tree failed: ${response.status}`);
        const data = await response.json();
        if (requestRevision !== revision) return undefined;
        if (!Array.isArray(data.tree)) throw new Error('Invalid tree response');
        onTree(data.tree);
        if (typeof data.isManager === 'boolean') onManager(data.isManager);
        return data.tree as T[];
      } catch (error) {
        if (requestRevision === revision) console.error('Load tree error:', error);
        return undefined;
      }
    },
  };
}
