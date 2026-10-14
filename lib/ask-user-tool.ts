/**
 * The model-facing `ask_user_question` tool, ported from DeepSeek Harness'
 * `packages/interaction/tool-ask-user`.
 *
 * The model sends one or more questions with ids unique within the call; the
 * answer echoes those ids. A recommended option goes first with `(Recommended)`
 * appended to its label. A timeout is never approval — the tool description
 * says so, and an unanswered question resolves to an empty answer set the model
 * must read as "the user did not answer".
 */
import { tool } from "ai";
import { z } from "zod";
import { askUser, type AskAnswer, type AskQuestion } from "@/lib/ask-user";

const questionSchema = z.object({
  id: z.string().describe("Stable id for this question; echoed in the answer."),
  question: z.string().describe("The specific question to ask the user."),
  header: z
    .string()
    .optional()
    .describe('Optional short heading for the question, such as "Confirm".'),
  options: z
    .array(
      z.object({
        label: z.string().describe("Short user-facing option label."),
        description: z
          .string()
          .optional()
          .describe("One sentence explaining the tradeoff or impact."),
      }),
    )
    .optional()
    .describe(
      'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
    ),
  multiSelect: z
    .boolean()
    .optional()
    .describe("Whether the user may select more than one option. Defaults to false."),
});

export function buildAskUserQuestionTool(opts: {
  conversationId?: string;
  runId?: string;
}) {
  return tool({
    description:
      "Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. " +
      "The turn pauses until they answer. Prefer this over guessing when a wrong guess wastes real work, when the " +
      "request is ambiguous between materially different interpretations, or when the user must approve something " +
      "destructive or outward-facing. Do not ask what you can cheaply find out yourself, and do not batch unrelated " +
      "questions into one call — a single focused question is easier to answer. " +
      "If the user does not answer, the answer comes back empty: treat that as 'not approved' and stop, never as consent.",
    inputSchema: z.object({
      questions: z.array(questionSchema).min(1).describe("Questions to ask the user before continuing."),
    }),
    execute: async ({ questions }, exec: any) => {
      const toolCallId = String(exec?.toolCallId ?? "");
      if (!toolCallId) {
        // Without a call id the client has no way to answer; fail the call
        // loudly rather than hang the turn.
        throw new Error("ask_user_question requires a tool call id.");
      }
      const askers: AskQuestion[] = questions.map((q) => ({
        id: q.id,
        question: q.question,
        ...(q.header !== undefined ? { header: q.header } : {}),
        ...(q.options !== undefined ? { options: q.options } : {}),
        ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
      }));
      const answers = await askUser(
        toolCallId,
        opts.conversationId ?? "",
        askers,
        opts.runId,
      );
      return {
        answers: answers.map((a: AskAnswer) => ({
          id: a.id,
          selected: a.selected,
          ...(a.custom !== undefined ? { custom: a.custom } : {}),
        })),
        answered: answers.length > 0,
      };
    },
  });
}