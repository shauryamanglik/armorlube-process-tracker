"use client";

import { Cog, Flame, Hourglass, Inbox } from "lucide-react";
import { dueUrgency, type Priority } from "@/lib/priority";
import { formatDuration } from "@/lib/time";
import { shortStep } from "@/lib/labels";

/**
 * One lot or order in a picker.
 *
 *   ┃ 092125-03            the number, alone on its line, never cut
 *   ┃ ⧗ 2h 14m    2d late  state and time on the left, due date on the right
 *
 * The number owns line one because it is the thing people are looking for,
 * and anything sharing that line was pushing it off the edge.
 *
 * State is said twice, quietly: the colour of the left edge, and a small icon
 * leading line two. Due date sits at the far right of line two. It is always
 * there, but coloured only when it is tomorrow, today or late, and otherwise
 * small and grey. Hot jobs get a flame in front of the due date.
 *
 * There is no priority number, because the list is already sorted by
 * priority, so the top of it is what to work next.
 */
export type ChipTone = "queue" | "process" | "idle" | "done" | "ready";

export default function RefChip({
  refId,
  tone,
  since,
  where,
  priority,
  today,
  selected,
  onClick,
}: {
  refId: string;
  tone: ChipTone;
  /** When it entered its current state, for the elapsed time. */
  since: string | null;
  /** The step it sits at, shown when there is no elapsed time to show. */
  where?: string;
  priority?: Priority;
  today: string;
  selected: boolean;
  onClick: () => void;
}) {
  const due = dueUrgency(priority?.due_date ?? null, today);
  const elapsed = since
    ? formatDuration(Date.now() - new Date(since).getTime())
    : null;
  const lead = elapsed ?? shortStep(where);

  const icon =
    tone === "process" ? (
      <Cog size={13} />
    ) : tone === "queue" ? (
      <Hourglass size={13} />
    ) : tone === "ready" ? (
      <Inbox size={13} />
    ) : null;

  return (
    <button
      className={`refchip ${tone}`}
      aria-pressed={selected}
      onClick={onClick}
      title={[
        refId,
        where && `at ${where}`,
        elapsed && `${elapsed} here`,
        priority?.hot && "hot job",
        priority?.due_date && `due ${priority.due_date}`,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <span className="rc-id mono">{refId}</span>

      <span className="rc-sub">
        <span className="rc-left">
          {icon && <span className={`rc-icon ${tone}`}>{icon}</span>}
          {lead && <span className="rc-lead">{lead}</span>}
        </span>

        {(due || priority?.hot) && (
          <span className="rc-right">
            {priority?.hot && <Flame size={12} className="flame" />}
            {due && <span className={`rc-due ${due.level}`}>{due.text}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Wide enough for the longest reference on screen, so no number is ever cut,
 * and never narrower than the second line needs.
 */
export function chipMinWidth(refs: string[]): number {
  const longest = refs.reduce((n, r) => Math.max(n, r.length), 9);
  // IBM Plex Mono advances 0.6em a character plus 0.02em letter spacing,
  // 10.54px at 17px. Rounded up, plus padding and border.
  const forNumber = longest * 10.6 + 31;
  // Line two at its fullest: icon, "12h 34m", then a flame and "2d late".
  const forDetail = 170;
  return Math.ceil(Math.max(forNumber, forDetail));
}
