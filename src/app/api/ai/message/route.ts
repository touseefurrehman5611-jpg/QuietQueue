export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body.message || "Your turn is coming soon!";
    const position = body.position;

    if (process.env.CLAUDE_API_KEY) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
model: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
            max_tokens: 100,
            messages: [
              {
                role: "user",
                content: `Write a friendly, concise alert message for a queue system. Visitor is ${position || 3} places away from their turn. Keep under 80 characters if possible.`,
              },
            ],
          }),
        });
if (res.ok) {
          const data = await res.json();
          const text = data.content?.[0]?.text;
          if (text) {
            return new Response(JSON.stringify({ message: text.trim() }), { status: 200 });
          }
          console.error("Claude API returned no text:", JSON.stringify(data));
        } else {
          // Without this the route silently falls back to the canned message, so
          // auth/credit/model failures look identical to success from the client.
          const detail = await res.text();
          console.error(`Claude API ${res.status}: ${detail}`);
        }
      } catch (err) {
        console.error("Claude API error:", err);
      }
    }

    return new Response(JSON.stringify({ message }), { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
