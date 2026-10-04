// POST /api/ai/message
//
// Turns a wait estimate into one friendly sentence.
//
// We use Groq, which speaks the OpenAI chat format, so this is a plain fetch
// with no SDK and no extra dependency.
//
// Body: { position, peopleAhead, minMinutes, maxMinutes, shouldAlert }
//
// IMPORTANT: the numbers are given to the model as FACTS and it is told to use
// them exactly. It is only writing the wording. If it is slow, rate limited, or
// the key is missing, we send the plain fallback sentence instead and the
// visitor still sees something useful. This route never returns an error for a
// model failure, because failing to be polite is not worth a blank screen.
//
// PRIVACY: nothing identifying leaves the server. We deliberately do NOT send
// the visitor's name, phone, or ticket number to Groq — only how many people
// are ahead and how many minutes. The sentence is about the wait, not the
// person, so the name was never needed. If someone later wants a personalised
// greeting, they have to add it here deliberately, knowing it goes to a third
// party.

import { ok, fail, run } from "@/lib/respond";
import { toCount } from "@/lib/validate";

// Keep this small and cheap. It writes one sentence about numbers we give it.
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Give up fast. A visitor staring at a spinner learns nothing, and the plain
// fallback is ready in the same instant.
const TIMEOUT_MS = 4000;

// The sentence we send when the model cannot be reached. Plain, but correct.
function fallbackMessage(
  position: number,
  minMinutes: number,
  maxMinutes: number,
  shouldAlert: boolean,
) {
  if (position <= 1) return "You are next. Please come to the desk.";

  const wait =
    minMinutes === maxMinutes
      ? `about ${minMinutes} minute${minMinutes === 1 ? "" : "s"}`
      : `${minMinutes} to ${maxMinutes} minutes`;

  if (shouldAlert) return `You are number ${position}. Come to the desk soon - ${wait}.`;

  return `You are number ${position} in line, about ${wait} to wait.`;
}

// Tell the model exactly what to do with the numbers. The instruction to keep
// the range is the important one: a model asked to be helpful will happily round
// "18 to 36 minutes" down to "20 minutes" and the estimate stops matching what
// the visitor is actually shown.
const SYSTEM_PROMPT = `You write one short, warm sentence for someone waiting in a queue.

Rules:
- Use ONLY the numbers given to you. Never recalculate or round them.
- Keep the wait as a range, exactly as written, if one is given.
- Maximum 25 words. One sentence. No emoji. No exclamation marks.
- If shouldAlert is true, tell them to come to the desk soon.
- If position is 1, tell them they are next.
- Plain text only. No quotes, no markdown.`;

// Groq's OpenAI-compatible chat endpoint.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function POST(request: Request) {
  return run(async () => {
    const body = await request.json();

    // We need a position to say anything sensible.
    const position = toCount(body?.position);
    if (position === null) return fail("position is required");
    if (position < 1) return fail("position must be 1 or more");

    const peopleAhead = toCount(body?.peopleAhead) ?? Math.max(0, position - 1);
    const minMinutes = toCount(body?.minMinutes) ?? 0;
    const maxMinutes = toCount(body?.maxMinutes) ?? minMinutes;
    const shouldAlert = body?.shouldAlert === true;

    const fallback = fallbackMessage(position, minMinutes, maxMinutes, shouldAlert);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      // No key is a setup problem, not a visitor problem. Send the fallback and
      // say so in the data so the team can see it during testing.
      return ok({ message: fallback, source: "fallback", reason: "GROQ_API_KEY is not set" });
    }

    const prompt = [
      `Position in line: ${position}`,
      `People ahead: ${peopleAhead}`,
      minMinutes === maxMinutes
        ? `Wait: about ${minMinutes} minute${minMinutes === 1 ? "" : "s"}`
        : `Wait: ${minMinutes} to ${maxMinutes} minutes`,
      `shouldAlert: ${shouldAlert}`,
    ].join("\n");

    try {
      // AbortSignal.timeout cancels the request if Groq is slow, so a hung
      // upstream cannot hold this route open past TIMEOUT_MS.
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
        return ok({ message: fallback, source: "fallback", reason: `Groq returned ${response.status}` });
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };

      // Grab the first text block the model actually produced. If it returned
      // nothing usable, the fallback is better than an empty string.
      const message = data.choices?.[0]?.message?.content?.trim();
      if (!message) {
        return ok({ message: fallback, source: "fallback", reason: "Groq returned no text" });
      }

      return ok({ message, source: "groq" });
    } catch (error) {
      // Network error, timeout, or a bad key. The visitor still gets a sentence.
      const reason = error instanceof Error ? error.message : "unknown error";
      return ok({ message: fallback, source: "fallback", reason });
    }
  });
}