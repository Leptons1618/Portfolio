import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    summary: z.string(),
    category: z.enum(['featured', 'ml-cv', 'ai-llm', 'full-stack', 'devtools', 'systems', 'simulation', 'other']),
    tags: z.array(z.string()),
    stack: z.array(z.string()),
    repoUrl: z.string().url(),
    demoUrl: z.string().url().optional(),
    docsUrl: z.string().url().optional(),
    caseStudySlug: z.string().optional(),
    featuredRank: z.number().optional(),
    status: z.enum(['active', 'stable', 'archived', 'wip']),
    year: z.number(),
    heroImage: z.string().optional(),
    heroVideo: z.string().optional(),
    highlights: z.array(z.string()),
    metrics: z.record(z.string()).optional(),
  }),
});

const caseStudies = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    subtitle: z.string(),
    heroImage: z.string().optional(),
    heroVideo: z.string().optional(),
    problem: z.string(),
    solution: z.string(),
    architectureImage: z.string().optional(),
    achievements: z.array(z.string()),
    stack: z.array(z.string()),
    repoUrl: z.string().url().optional(),
    demoUrl: z.string().url().optional(),
    date: z.string(),
    readTime: z.string().optional(),
  }),
});

export const collections = { projects, 'case-studies': caseStudies };
