// Turns a wait estimate into one friendly sentence.
//
// We use Groq, which speaks the OpenAI chat format, so this is a plain fetch
// with no SDK and no extra dependency.
//
// IMPORTANT: the numbers are given to the model as FACTS and it is told to use
// them exactly. It is only writing the wording. If it is slow, rate limited, the
// key is missing, or the model is wrong, we send the plain fallback sentence
// instead and the visitor still sees something useful. This function never
// throws and never rejects, because failing to be polite is not worth a blank
// screen. That is the whole design: every failure path ends in a sentence.
//
// PRIVACY: nothing identifying leaves the server. We deliberately do NOT send
// the visitor's name, phone, or ticket number to Groq — only their position and
// the minute range. The sentence is about the wait, not the person, so the name
// was never needed. A commit in this repo was once blocked for sending visitor
// names to a third-party API, and the signature below still has no `name`
// field — not even optional. If someone later wants a personalised greeting, it
// has to be added here deliberately, knowing it goes to a third party.

/** Which moment in the visit this sentence is for. */
export type MessageType = "joined" | "alert" | "delay" | "called";

/** Where the sentence came from. `fallback` always carries a `reason`. */
export type MessageSource = "groq" | "fallback";

export type VisitorMessage = {
  message: string;
  source: MessageSource;
  reason?: string;
};

// Keep this small and cheap. It writes one sentence about numbers we give it.
//
// Checked against the models this key can actually reach. If you get
// "model_not_found" from Groq, run this to see what your key has:
//
//   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
//
// llama-3.3-70b-versatile returns model_not_found on this key. Some Groq models
// (for example gpt-oss-120b) are reasoning models and return an empty `content`
// with the text under a different channel, so they do not work here. This one
// returns plain text.
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

// Give up fast. A visitor staring at a spinner learns nothing, and the plain
// fallback is ready in the same instant.
const TIMEOUT_MS = 4000;

// Groq's OpenAI-compatible chat endpoint.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Tell the model exactly what to do with the numbers. The instruction to keep
// the range is the important one: a model asked to be helpful will happily round
// "18 to 36 minutes" down to "20 minutes" and the estimate stops matching what
// the visitor is actually shown.
const SYSTEM_PROMPT = `You write one short, warm sentence for someone waiting in a queue.

Rules:
- Use ONLY the numbers given to you. Never recalculate or round them.
- Keep the wait as a range, exactly as written, if one is given.
- Maximum 25 words. One sentence. No emoji. No exclamation marks.
- Write the sentence for the moment given: they just joined, the desk is about
  to call them, their wait got longer, or they are being called now.
- If they are being called, tell them to come to the desk.
- Plain text only. No quotes, no markdown.`;

// The sentence we send when the model cannot be reached. Plain, but correct.
//
// Every branch returns a real sentence: no empty string, ever. This is the
// function that stops the demo from showing a blank screen.
function fallbackMessage(
  position: number,
  minMinutes: number,
  maxMinutes: number,
  type: MessageType,
): string {
  // Being at the desk ends the wait, so no estimate belongs in this sentence.
  if (type === "called" || position <= 1) return "Please come to the desk.";

  // The bare noun phrase, no "about" — the sentence supplies it, so an equal
  // range cannot read "about about 1 minute".
  const wait =
    minMinutes === maxMinutes
      ? `${minMinutes} minute${minMinutes === 1 ? "" : "s"}`
      : `${minMinutes} to ${maxMinutes} minutes`;

  if (type === "alert") return `You are number ${position}. Come to the desk soon - about ${wait}.`;

  if (type === "delay") {
    return `Sorry for the longer wait. You are number ${position}, about ${wait} to wait.`;
  }

  return `You are number ${position} in line, about ${wait} to wait.`;
}

/**
 * One friendly sentence about the wait. Never throws, never rejects.
 *
 * Returns the model's wording when Groq answers, and the plain fallback for
 * every failure — missing key, timeout, rate limit, wrong model, network error,
 * empty completion. `reason` says which, so the team can see it while testing.
 */
export async function generateVisitorMessage(input: {
  position: number;
  minMinutes: number;
  maxMinutes: number;
  type: MessageType;
}): Promise<VisitorMessage> {
  const { position, minMinutes, maxMinutes, type } = input;
  const fallback = fallbackMessage(position, minMinutes, maxMinutes, type);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // No key is a setup problem, not a visitor problem.
    return { message: fallback, source: "fallback", reason: "GROQ_API_KEY is not set" };
  }

  const waitFact =
    minMinutes === maxMinutes
      ? `about ${minMinutes} minute${minMinutes === 1 ? "" : "s"}`
      : `${minMinutes} to ${maxMinutes} minutes`;

  const prompt = [
    `Moment: ${type}`,
    `Position in line: ${position}`,
    `Wait: ${waitFact}`,
  ].join("\n");

  try {
    // AbortSignal.timeout cancels the request if Groq is slow, so a hung
    // upstream cannot hold the caller open past TIMEOUT_MS.
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      return { message: fallback, source: "fallback", reason: `Groq returned ${response.status}` };
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    // Grab the first text block the model actually produced. If it returned
    // nothing usable, the fallback is better than an empty string.
    const message = data.choices?.[0]?.message?.content?.trim();
    if (!message) {
      return { message: fallback, source: "fallback", reason: "Groq returned no text" };
    }

    return { message, source: "groq" };
  } catch (error) {
    // Network error, timeout, or a bad key. The visitor still gets a sentence.
    const reason = error instanceof Error ? error.message : "unknown error";
    return { message: fallback, source: "fallback", reason };
  }
}

// Run with: node src/lib/ai.ts
// The fallback is the one thing that must never be empty, so check every type.
function selfCheck() {
  const assert = (label: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      process.exitCode = 1;
    } else {
      console.log(`ok  ${label}`);
    }
  };

  const types: MessageType[] = ["joined", "alert", "delay", "called"];

  // No combination of input may produce a blank sentence.
  for (const type of types) {
    for (const [position, min, max] of [[1, 0, 0], [2, 12, 18], [9, 1, 1], [0, 5, 5]]) {
      const out = fallbackMessage(position, min, max, type);
      assert(`${type} @${position} has text`, out.trim().length > 0, true);
    }
  }

  // Called wins over the estimate: no wait, just the instruction.
  assert("called is the desk instruction", fallbackMessage(7, 12, 18, "called"), "Please come to the desk.");
  assert("next in line is the desk instruction", fallbackMessage(1, 12, 18, "joined"), "Please come to the desk.");

  assert("joined keeps the range", fallbackMessage(4, 12, 18, "joined"), "You are number 4 in line, about 12 to 18 minutes to wait.");
  assert("alert asks them to come", fallbackMessage(3, 12, 18, "alert"), "You are number 3. Come to the desk soon - about 12 to 18 minutes.");
  assert("delay owns up to the longer wait", fallbackMessage(3, 24, 36, "delay"), "Sorry for the longer wait. You are number 3, about 24 to 36 minutes to wait.");

  // A single-minute wait is not "1 minutes".
  assert("one minute is singular", fallbackMessage(2, 1, 1, "joined"), "You are number 2 in line, about 1 minute to wait.");

  console.log(process.exitCode ? "\nFAILED" : "\nall checks passed");
}

if (process.argv[1]?.endsWith("ai.ts")) selfCheck();