/**
 * Resume content, shared by the public /resume page and the admin editor that
 * seeds its form from it. Editing here changes what the site renders.
 */

export interface ExperienceEntry {
  title: string;
  company: string;
  dates: string;
  location: string;
  description: string;
}

export interface SkillGroup {
  category: string;
  items: string[];
}

export interface EducationEntry {
  school: string;
  degree: string;
  dates: string;
}

export const person = {
  name: 'Anish Giri',
  role: 'Software Engineer',
  location: 'Bengaluru, Karnataka, India',
  address: 'Nanjappa Layout, Adugodi, Bengaluru, Karnataka, 560030',
  email: 'anishgiri163@gmail.com',
  phone: '6294957979',
  linkedin: 'https://www.linkedin.com/in/anish-giri-a4031723a',
  summary:
    "As a curious, skeptical, and agnostic carbon-based bipedal, I thrive on delving into the depths of knowledge and discovering the world's treasures. With a strong interest in technology, I find peace in the Linux environment and enjoy deciphering its complexities. As an AI, ML, and Data Science enthusiast, I am eager to realize these areas' full potential and leverage their transformative impact. With an unshakable passion for coding, I am always looking for new ways to broaden my programming language vocabulary. My unquenchable curiosity drives my ambition to explore the fields of AI, ML, and Data Science, where I hope to make a significant contribution.",
};

export const experience: ExperienceEntry[] = [
  {
    title: 'Software Engineer',
    company: 'Axcend Automation and Software Solutions pvt.Ltd',
    dates: 'July 2024 - Present (1 year 10 months)',
    location: 'Bengaluru, Karnataka, India',
    description:
      'As a Trainee Engineer at Axcend Automation and Software Solutions, I am responsible for developing and maintaining software for industrial automation projects. My role involves working with network protocols to ensure seamless communication between devices and systems. I collaborate on designing and managing control systems and SCADA systems, gaining hands-on experience with PLCs, HMIs, and other automation components. Additionally, I integrate hardware and software components to ensure efficient and reliable operation.',
  },
  {
    title: 'Subject Matter Expert',
    company: 'Chegg India',
    dates: 'June 2023 - September 2024 (1 year 4 months)',
    location: '',
    description: '',
  },
  {
    title: 'Intern',
    company: 'Axcend Automation and Software Solutions pvt.Ltd',
    dates: 'January 2024 - May 2024 (5 months)',
    location: 'Bengaluru, Karnataka, India',
    description: '',
  },
];

export const skills: SkillGroup[] = [
  { category: 'Top Skills', items: ['Next.js', 'React.js', 'TypeScript'] },
  { category: 'ML / CV', items: ['PyTorch', 'TensorFlow', 'OpenCV', 'scikit-learn', 'YOLO'] },
  { category: 'Languages', items: ['Python', 'TypeScript', 'Go', 'Rust', 'SQL'] },
  { category: 'Web', items: ['Astro', 'React', 'FastAPI', 'Node.js', 'Tailwind'] },
  { category: 'Data', items: ['PostgreSQL', 'Redis', 'Apache Kafka', 'DuckDB'] },
  { category: 'Infra', items: ['Docker', 'GitHub Actions', 'Cloudflare', 'Vercel'] },
];

export const certifications: string[] = [
  'Artificial Intelligence Fundamentals',
  'Problem Solving (Basic)',
  'SQL (Intermediate)',
  'Data Fundamentals',
  'SQL (Basic)',
];

export const education: EducationEntry[] = [
  {
    school: 'Pondicherry University, Puducherry',
    degree: "Master's degree, Computer Science",
    dates: 'December 2022 - July 2024',
  },
];
