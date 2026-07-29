/**
 * `ServiceView.preVisitQuestions` is `unknown` on the wire (it is a JSON column
 * in Prisma), so it gets narrowed here once and nowhere else. Anything that is
 * not a `{ q: string }` object is dropped rather than rendered as "[object
 * Object]".
 *
 * The seeded questions also carry an `effect` field (tool hints, urgency
 * promotion, add-on chips). That is dispatch/pricing logic and the UI must not
 * act on it — notably `effect.addOnChip.pricePaise` is an amount the client is
 * not allowed to use. We read only `q`, `options`, `type` and `optional`.
 */
import type { PreVisitQuestion } from './types';

export function parsePreVisitQuestions(raw: unknown): PreVisitQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: PreVisitQuestion[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.q !== 'string' || record.q.length === 0) continue;

    const options = Array.isArray(record.options)
      ? record.options.filter((o): o is string => typeof o === 'string')
      : undefined;

    questions.push({
      q: record.q,
      ...(options !== undefined && options.length > 0 ? { options } : {}),
      ...(typeof record.type === 'string' ? { type: record.type } : {}),
      ...(record.optional === true ? { optional: true } : {}),
    });
  }
  return questions;
}

/** Photo upload is not supported on the web yet — those questions are shown as skipped. */
export function isAnswerable(question: PreVisitQuestion): boolean {
  return question.type !== 'media';
}
