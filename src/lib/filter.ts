export interface ProjectFilter {
  q?: string;
  category?: string;
  tags?: string[];
  sort?: 'featured' | 'newest' | 'az';
}

export function parseFiltersFromURL(params: URLSearchParams): ProjectFilter {
  return {
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
    tags: params.get('tags')?.split(',').filter(Boolean) || undefined,
    sort: (params.get('sort') as ProjectFilter['sort']) || 'featured',
  };
}

export function buildFilterURL(filters: ProjectFilter): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.category) params.set('category', filters.category);
  if (filters.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters.sort && filters.sort !== 'featured') params.set('sort', filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
