import { z } from "zod";
import type {
  HistoryEvent,
  HistoryPage,
  JsonRecord,
  Run,
} from "./cezar-client.js";
import { failure } from "./contracts.js";
const questionEventSchema = z.object({
  requestId: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      header: z.string().optional(),
      multiSelect: z.boolean().optional(),
      options: z
        .array(
          z.object({
            label: z.string(),
            description: z.string().optional(),
            recommended: z.boolean().optional(),
          }),
        )
        .optional(),
    }),
  ),
});
export function questionFromEvent(event: HistoryEvent): JsonRecord | undefined {
  if (event.type !== "ask.requested") return undefined;
  const parsed = questionEventSchema.safeParse(event.payload);
  if (!parsed.success)
    throw failure(
      "incompatible_server",
      "The observed question has an unsupported shape.",
    );
  return { ...parsed.data, askedAt: event.ts };
}
/** Ordinary root questions live in persisted ask.requested events; dispatched tasks also store pendingAsk. */
export function pendingQuestion(
  run: Run,
  history: HistoryPage,
): JsonRecord | undefined {
  if (run.dispatch?.pendingAsk) return run.dispatch.pendingAsk;
  if (run.status !== "waiting") return undefined;
  for (const event of [...history.events].sort((a, b) => b.seq - a.seq)) {
    if (event.type === "user-message" || event.type === "user")
      return undefined;
    const question = questionFromEvent(event);
    if (question) return question;
  }
  return undefined;
}
