import type { Questions, State } from "../types.ts";
import { DEPARTMENT, RETURN_REASON, SEVERITY, PRIORITY, TONE } from "./schemas.ts";

/**
 * Out-of-scope probe set. Every input here is unrelated to the question it is
 * asked with (CLINC150-style "oos" utterances, chit-chat, trivia, gibberish,
 * and other-domain commands). The correct behaviour is NOT a confident answer:
 * a trustworthy model returns low confidence or abstains. Independent tests of
 * Jev found 0 of 30 such inputs flagged, answered at 0.99 confidence; this set
 * makes that failure measurable for every backend on the leaderboard.
 *
 * Only Choice and Score questions are used: for a yes/no Noul question an
 * off-topic input has a correct answer ("no, this is not a refund request").
 */
export type OodCase = { id: string; state: State; questions: Questions };

const SCHEMAS: ReadonlyArray<[string, Questions]> = [
  ["department", DEPARTMENT],
  ["return_reason", RETURN_REASON],
  ["severity", SEVERITY],
  ["priority", PRIORITY],
  ["tone", TONE],
];

const INPUTS: readonly string[] = [
  "What's the weather going to be like in Paris tomorrow?",
  "Tell me a joke about penguins.",
  "How many calories are in a banana?",
  "asdf qwerty zxcv uiop",
  "Who won the 1998 World Cup final?",
  "Can you recommend a good lasagna recipe?",
  "Translate good morning into Japanese.",
  "What is the capital of Australia?",
  "My cat keeps sleeping on the keyboard.",
  "Set an alarm for 7am tomorrow.",
  "What is the square root of 144?",
  "Play some jazz in the kitchen.",
  "How tall is Mount Everest?",
  "Write a haiku about autumn leaves.",
  "Remind me to water the plants on Sunday.",
  "What time does the sun set in Istanbul today?",
  "Is a hotdog a sandwich?",
  "Book a table for two at an Italian restaurant.",
  "Who painted the Mona Lisa?",
  "How do I say thank you in German?",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "What's a good name for a golden retriever puppy?",
  "How many legs does a spider have?",
  "Turn on the living room lamp.",
  "Summarize the plot of Hamlet in one sentence.",
  "Which planet has the most moons?",
  "Recommend a science fiction novel.",
  "What year did the Berlin Wall fall?",
  "Convert 30 degrees Celsius to Fahrenheit.",
  "Sing me happy birthday.",
];

/** 30 inputs x 5 schemas = 150 out-of-scope (input, question) pairs. */
export const OOD_CASES: OodCase[] = INPUTS.flatMap((state, i) =>
  SCHEMAS.map(([name, questions]) => ({ id: `ood-${i + 1}-${name}`, state, questions })),
);
