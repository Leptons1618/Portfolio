-- The resume's seeded summary was model boilerplate — "As a curious, skeptical,
-- and agnostic carbon-based bipedal… As an AI, ML, and Data Science enthusiast…"
-- — sitting in the one artifact a recruiter reads first, on the site whose whole
-- argument is "practical systems that ship".
--
-- Guarded, not blind: the UPDATE fires only while that text is still there.
-- If the summary was already rewritten in admin, the WHERE misses and the
-- owner's words stand. Running it twice is harmless for the same reason.
UPDATE documents
SET json = json_set(
  documents.json,
  '$.summary',
  'I work at the intersection of machine learning, computer vision, and software engineering. I build practical systems that ship.'
)
WHERE slug = 'resume'
  AND instr(json_extract(documents.json, '$.summary'), 'carbon-based bipedal') > 0;
