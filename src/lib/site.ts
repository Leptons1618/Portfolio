/**
 * Site identity — the one place the owner's name, contact details and external
 * profiles are written down. Everything that renders them (header, footer,
 * about, home, resume module, admin, robots.txt) imports from here.
 *
 * `url` must match the CNAME in `public/CNAME` and the domain configured in
 * the repository's Pages settings. `scripts/check-content.mjs` asserts it.
 */

export const site = {
  name: 'Anish Giri',
  role: 'Software Engineer',
  roleLong: 'Software Engineer (ML/CV + Full-Stack)',
  tagline: 'ML/CV engineer and full-stack developer portfolio.',
  bio: 'I work at the intersection of machine learning, computer vision, and software engineering. I build practical systems that ship.',

  url: 'https://anishgiri.dev',
  ogImage: '/images/ui/og-default.png',

  email: 'anishgiri163@gmail.com',
  location: 'Bengaluru, Karnataka, India',
  address: 'Nanjappa Layout, Adugodi, Bengaluru, Karnataka, 560030',
  phone: '6294957979',

  githubUser: 'Leptons1618',
  github: 'https://github.com/Leptons1618',
  repo: 'https://github.com/Leptons1618/Portfolio',
  linkedin: 'https://www.linkedin.com/in/anish-giri-a4031723a',

  /** Portrait used by the home hero and the about page. */
  photo: 'https://github.com/user-attachments/assets/ac0a8a77-f1eb-45fa-8670-9b13cefd85e4',
} as const;

/** Absolute URL for a site-relative path — Open Graph and sitemaps need one. */
export function absoluteUrl(path: string, origin: string | URL = site.url): string {
  return new URL(path, origin).href;
}
