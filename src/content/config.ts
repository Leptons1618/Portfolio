import { defineCollection, z } from 'astro:content';

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    /* "Featured" is a rank, not a category — see `featuredRank` below. Keeping
       it out of this enum stops the projects filter bar from having two
       different meanings for the same key. */
    category: z.enum(['ml-cv', 'ai-llm', 'full-stack', 'devtools', 'systems', 'simulation', 'other']),
    tags: z.array(z.string()),
    stack: z.array(z.string()),
    repoUrl: z.string().url(),
    demoUrl: z.string().url().optional(),
    caseStudySlug: z.string().optional(),
    featuredRank: z.number().optional(),
    status: z.enum(['active', 'stable', 'archived', 'wip']),
    year: z.number(),
    heroImage: z.string().optional(),
    highlights: z.array(z.string()),
    /* Written by the admin's visibility switch. A hidden project keeps its
       file and its history but drops out of every listing and stops getting a
       detail page — the way to retire work without deleting it. */
    hidden: z.boolean().default(false),
  }),
});

const caseStudies = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
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

const journal = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.string(),
    tags: z.array(z.string()),
    readTime: z.string().optional(),
    videoDuration: z.string().optional(),
    heroImage: z.string().optional(),
    /* Drafts are authored in the admin editor and kept out of production builds. */
    draft: z.boolean().default(false),
  }),
});

export const collections = { projects, 'case-studies': caseStudies, journal };
