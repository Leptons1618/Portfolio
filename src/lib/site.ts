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
  /* ASSUMED: no X handle was recorded anywhere in this repository when the
     contact section was built, so this reuses the GitHub login. Correct it
     here and nowhere else — the contact cards and the footer read it. */
  twitter: 'https://x.com/Leptons1618',
  /** Read by the contact terminal's `status` line. Copy, not a schedule. */
  availability: 'Open to opportunities · ML/CV, full-stack, systems',
  /** IANA zone for the terminal's clock line. */
  timezone: 'Asia/Kolkata',

  /**
   * Portrait used by the home hero, the about page and the admin rail.
   *
   * Served from this origin, not from `github.com/user-attachments`. A remote
   * portrait meant the largest element in the hero waited on a DNS lookup, a
   * TLS handshake and a redirect to a third party before it could start
   * downloading, on every load — and the 227 KB PNG behind that URL is 21 KB as
   * a WebP of the same pixels.
   */
  photo: '/images/ui/portrait.webp',
} as const;

/** Absolute URL for a site-relative path — Open Graph and sitemaps need one. */
export function absoluteUrl(path: string, origin: string | URL = site.url): string {
  return new URL(path, origin).href;
}
