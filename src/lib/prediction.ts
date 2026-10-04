// Guess how long someone has to wait.
//
// predict() is plain arithmetic so it works with no database and no API key.
// waitEstimate() wraps it with the one piece of context it cannot know on its
// own: how long visits have ACTUALLY been taking lately.
//
// Nothing here talks to the database. The routes fetch the recent service times
// and pass them in, which keeps this file testable with `node` alone.

import type { PredictionResult, Queue } from "./types";

// One person takes about 300 seconds (5 minutes) if nothing is set.
const DEFAULT_SERVICE_SECONDS = 300;

// How many finished visits we average before we trust them over the queue's
// own setting. Below this, the queue's own average wins: two data points are
// not a trend, and swinging the whole dashboard on them looks broken.
const MIN_SAMPLES_FOR_MOVING_AVERAGE = 3;

// Alert the visitor when this many people are ahead of them.
const DEFAULT_ALERT_AT_POSITION = 3;

// Our guess is not a single number, it is a window. We say the real answer is
// between 0.8x and 1.2x of the middle estimate.
const WINDOW_LOW = 0.8;
const WINDOW_HIGH = 1.2;

export function predict(
  peopleAhead: number,
  avgServiceSeconds: number = DEFAULT_SERVICE_SECONDS,
  speedMultiplier = 1,
  alertAtPosition: number = DEFAULT_ALERT_AT_POSITION,
): PredictionResult {
  // Guards for numbers that came from the database or the client.
  const safeAhead = Math.max(0, peopleAhead);
  const safeSpeed = Math.max(0.1, speedMultiplier);
  const safeService = avgServiceSeconds > 0 ? avgServiceSeconds : DEFAULT_SERVICE_SECONDS;

  // The middle estimate in minutes: how many people are ahead, how long each
  // takes, how fast the desk is moving. Speed divides: 2 means half the wait.
  const middleMinutes = (safeAhead * safeService) / safeSpeed / 60;

  // Round up. Saying 12 when it is really 11.4 is fine. Saying 12 when it is
  // 12.4 is how people stop trusting the number.
  const minMinutes = Math.ceil(middleMinutes * WINDOW_LOW);
  const maxMinutes = Math.ceil(middleMinutes * WINDOW_HIGH);

  // Position 1 means you are next, so peopleAhead is one less than position.
  const position = safeAhead + 1;

  return {
    position,
    peopleAhead: safeAhead,
    minMinutes,
    maxMinutes,
    // Alert on how close you are in line, NOT on how many minutes you wait.
    // A visitor 3rd in line waits almost nothing but still needs to know to
    // come to the desk.
    shouldAlert: safeAhead <= alertAtPosition,
  };
}

// The real service time to use, averaged from what actually happened recently
// instead of trusting the number someone typed when the queue was created.
//
// This is the part that makes the estimate honest. A queue set to 300s when it
// was empty is a guess; after a few real visits, the average of those visits is
// evidence. Below MIN_SAMPLES_FOR_MOVING_AVERAGE we keep the queue's own value,
// because a moving average off one or two samples jumps around too much for
// anyone to trust.
//
// recentDurations comes from db.getRecentServiceDurations(), newest first.
// Zero-second rows are ignored: a visit logged with no timing tells us nothing
// about how long a visit takes.
export function effectiveServiceSeconds(
  recentDurations: number[],
  queueAverage: number,
): number {
  const usable = recentDurations.filter((d) => Number.isFinite(d) && d > 0);

  if (usable.length < MIN_SAMPLES_FOR_MOVING_AVERAGE) return queueAverage;

  const sum = usable.reduce((total, d) => total + d, 0);
  return sum / usable.length;
}

// The one call the routes make. Folds the moving average into the queue's own
// speed slider and alert setting, so no route has to remember which numbers
// take priority.
export function waitEstimate(
  peopleAhead: number,
  queue: Queue,
  recentDurations: number[],
): PredictionResult {
  const avgServiceSeconds = effectiveServiceSeconds(recentDurations, queue.avgServiceSeconds);

  return predict(peopleAhead, avgServiceSeconds, queue.speedMultiplier, queue.alertAtPosition);
}

// Turn the estimate into a few plain words the AI can turn into a sentence.
// We hand the model facts, not a feeling, so it cannot invent a time.
export function estimateFacts(estimate: PredictionResult) {
  return {
    position: estimate.position,
    peopleAhead: estimate.peopleAhead,
    minMinutes: estimate.minMinutes,
    maxMinutes: estimate.maxMinutes,
    shouldAlert: estimate.shouldAlert,
  };
}

// Run with: node src/lib/prediction.ts
function selfCheck() {
  const assert = (label: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      process.exitCode = 1;
    } else {
      console.log(`ok  ${label}`);
    }
  };

  // Nobody ahead: no wait at all.
  assert("no one ahead", predict(0), {
    position: 1, peopleAhead: 0, minMinutes: 0, maxMinutes: 0, shouldAlert: true,
  });

  // 3 people at 300s each, normal speed = 15 min middle -> 12 to 18 window.
  // This is the brief's own example, so it is the one that must stay true.
  assert("3 ahead gives a 12 to 18 window", predict(3), {
    position: 4, peopleAhead: 3, minMinutes: 12, maxMinutes: 18, shouldAlert: true,
  });

  // Alert is about position, not minutes. 3 ahead alerts even though the wait
  // is short. 4 ahead does not, even though the wait is longer.
  assert("3 ahead alerts", predict(3).shouldAlert, true);
  assert("4 ahead does not alert", predict(4).shouldAlert, false);

  // Staff moving the speed slider changes the wait.
  assert("speed 2 halves the wait", predict(3, 300, 2).minMinutes, 6);
  assert("speed 4 quarters the wait", predict(3, 300, 4).minMinutes, 3);

  // A speed of 0 must not divide the wait down to nothing. It clamps to 0.1,
  // so 3 people at 300s become 9000s = 150 minutes, and the top of the window
  // is 150 x 1.2 = 180.
  assert("speed 0 is clamped", predict(3, 300, 0).maxMinutes, 180);

  // The window is 0.8x to 1.2x of the middle, and max is never below min.
  const w = predict(10);
  assert("window low is 0.8x", w.minMinutes, Math.ceil((10 * 300) / 1 / 60 * 0.8));
  assert("window high is 1.2x", w.maxMinutes, Math.ceil((10 * 300) / 1 / 60 * 1.2));

  // A queue that sets its own alert point is respected.
  assert("custom alert point", predict(5, 300, 1, 5).shouldAlert, true);
  assert("custom alert point excludes", predict(6, 300, 1, 5).shouldAlert, false);

  // ---- the moving average over recent service times ----

  // Too few real samples: keep the number the queue was set up with.
  assert("no history uses the queue average", effectiveServiceSeconds([], 300), 300);
  assert("one sample is not enough", effectiveServiceSeconds([120], 300), 300);
  assert("two samples are not enough", effectiveServiceSeconds([120, 180], 300), 300);

  // Three real samples beat the setting. 120 + 180 + 240 = 540 / 3 = 180.
  assert("three samples move the average", effectiveServiceSeconds([120, 180, 240], 300), 180);

  // Zero-second rows are not evidence of a fast desk. [0, 0, 0] must fall back
  // to 300 rather than average to 0 and promise everyone is seen instantly.
  assert("zero samples are ignored", effectiveServiceSeconds([0, 0, 0], 300), 300);
  // Mixed: the zero drops out, leaving 120 + 180 + 240 = 540 / 3 = 180.
  assert("zero rows drop out of a real set", effectiveServiceSeconds([0, 120, 180, 240], 300), 180);
  // Dropping the zeros counts against the threshold. Only two real visits are
  // left here, so we still do not trust them over the queue's own setting.
  assert("dropping zeros can leave too few samples", effectiveServiceSeconds([0, 120, 180], 300), 300);

  // A desk that got faster than advertised now predicts faster. 3 people at a
  // real 150s average is 7.5 min, so the window is 6 to 9.
  const fastDesk = waitEstimate(3, { avgServiceSeconds: 300, speedMultiplier: 1, alertAtPosition: 3 } as Queue, [120, 180, 150]);
  assert("fast desk shortens the window", fastDesk.maxMinutes, 9);

  // A desk that got slower than advertised predicts slower. 3 people at a real
  // 600s average is 30 min, so the window is 24 to 36.
  const slowDesk = waitEstimate(3, { avgServiceSeconds: 300, speedMultiplier: 1, alertAtPosition: 3 } as Queue, [600, 600, 600]);
  assert("slow desk lengthens the window", slowDesk.maxMinutes, 36);

  // Speed still wins over history: a doubled desk halves whatever the average
  // says. 3 people at a real 150s average at 2x is 3.75 min -> window to 5.
  const fastAndQuick = waitEstimate(3, { avgServiceSeconds: 300, speedMultiplier: 2, alertAtPosition: 3 } as Queue, [120, 180, 150]);
  assert("speed still divides the history", fastAndQuick.maxMinutes, 5);

  console.log(process.exitCode ? "\nFAILED" : "\nall checks passed");
}

if (process.argv[1]?.endsWith("prediction.ts")) selfCheck();