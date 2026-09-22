-- What a million tokens costs on the model this row answers with, in USD,
-- copied from the vendor's own listing when a model is picked on the AI
-- screen — the same moment `max_output_tokens` is filled in, and for the same
-- reason: the number is already in the picker's payload and nowhere else.
--
-- `REAL`, nullable, and only ever a cost *estimate*. A row written by hand, or
-- one whose model the vendor does not price (OpenAI's listing carries no
-- prices at all), stays NULL and the assistant says the cost is unknown rather
-- than printing a zero. The vendor's dashboard remains the authority on spend;
-- this is the number that makes two models comparable while the author is
-- choosing between them.
--
-- Prices are per million tokens because that is the unit every vendor quotes
-- in prose and the unit `normaliseModels()` already normalises to. Negative
-- values are refused on read (`clampPrice()` in `ai.ts`), because
-- OpenRouter's `-1` means "depends which model this routes to" and passed
-- through it renders as a negative cost.
ALTER TABLE ai_providers ADD COLUMN price_prompt REAL;
ALTER TABLE ai_providers ADD COLUMN price_completion REAL;
