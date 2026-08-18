-- Singleton documents: content that is one record rather than a collection.
--
-- The resume is the only one, and it is here for the same reason everything
-- else moved: while it lived in `src/lib/resume.ts`, saving it was a commit,
-- and a commit meant the GitHub App needed write access to the repository. It
-- was the last thing holding that permission open — see decision 19.
--
-- One JSON column rather than a table per section. The resume is a single
-- deeply nested document read by exactly two pages and written whole by one
-- editor; normalising it into `experience`, `skills`, `certifications` and
-- `education` tables would buy per-row integrity nothing ever queries and cost
-- four joins to render one page. The shape is enforced where it is used, by the
-- interfaces in `src/lib/resume.ts`.
--
-- The primary key is called `slug` so this table is reachable through the same
-- write endpoint as the collections, with the same tested column allowlist,
-- rather than needing a second one.
CREATE TABLE documents (
  slug        TEXT PRIMARY KEY,
  json        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The resume as it stood in `src/lib/resume.ts` when it moved. Identity fields
-- are deliberately absent: they live in `src/lib/site.ts` and are composed back
-- on read, so there is still exactly one place the owner's contact details are
-- written down.
INSERT INTO documents (slug, json) VALUES ('resume', '{"summary":"As a curious, skeptical, and agnostic carbon-based bipedal, I thrive on delving into the depths of knowledge and discovering the world''s treasures. With a strong interest in technology, I find peace in the Linux environment and enjoy deciphering its complexities. As an AI, ML, and Data Science enthusiast, I am eager to realize these areas'' full potential and leverage their transformative impact. With an unshakable passion for coding, I am always looking for new ways to broaden my programming language vocabulary. My unquenchable curiosity drives my ambition to explore the fields of AI, ML, and Data Science, where I hope to make a significant contribution.","experience":[{"title":"Software Engineer","company":"Axcend Automation and Software Solutions pvt.Ltd","dates":"July 2024 - Present (1 year 10 months)","location":"Bengaluru, Karnataka, India","description":"As a Trainee Engineer at Axcend Automation and Software Solutions, I am responsible for developing and maintaining software for industrial automation projects. My role involves working with network protocols to ensure seamless communication between devices and systems. I collaborate on designing and managing control systems and SCADA systems, gaining hands-on experience with PLCs, HMIs, and other automation components. Additionally, I integrate hardware and software components to ensure efficient and reliable operation."},{"title":"Subject Matter Expert","company":"Chegg India","dates":"June 2023 - September 2024 (1 year 4 months)","location":"","description":""},{"title":"Intern","company":"Axcend Automation and Software Solutions pvt.Ltd","dates":"January 2024 - May 2024 (5 months)","location":"Bengaluru, Karnataka, India","description":""}],"skills":[{"category":"Top Skills","items":["Next.js","React.js","TypeScript"]},{"category":"ML / CV","items":["PyTorch","TensorFlow","OpenCV","scikit-learn","YOLO"]},{"category":"Languages","items":["Python","TypeScript","Go","Rust","SQL"]},{"category":"Web","items":["Astro","React","FastAPI","Node.js","Tailwind"]},{"category":"Data","items":["PostgreSQL","Redis","Apache Kafka","DuckDB"]},{"category":"Infra","items":["Docker","GitHub Actions","Cloudflare","Vercel"]}],"certifications":["Artificial Intelligence Fundamentals","Problem Solving (Basic)","SQL (Intermediate)","Data Fundamentals","SQL (Basic)"],"education":[{"school":"Pondicherry University, Puducherry","degree":"Master''s degree, Computer Science","dates":"December 2022 - July 2024"}]}');
