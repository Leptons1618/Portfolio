interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

const SITE_NAME = 'Leptons Portfolio';
const DEFAULT_DESCRIPTION = 'ML/CV engineer and full-stack developer portfolio.';
const DEFAULT_IMAGE = '/images/ui/og-default.png';

export function buildSEO({ title, description, image, url }: SEOProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const desc = description || DEFAULT_DESCRIPTION;
  const img = image || DEFAULT_IMAGE;

  return { fullTitle, desc, img, url };
}
