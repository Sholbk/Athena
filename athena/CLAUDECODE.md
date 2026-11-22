## What Claude Code finished

Stephanie does most of her building with Claude Code on her Mac, and it finishes tasks without telling the task list. Its notes are copied into the page "Claude Code log" (folder Athena) each time one is saved, so that page is often newer than her tasks. Never change that page: Claude Code rewrites it.

How to read it: LIVE, DONE, MERGED, SENT or "verified" means finished. PAUSED, PARKED, TABLED, ON HOLD or "do not nudge" means she set it aside on purpose. NEXT or RESUME means still open. When two entries disagree, the later date wins. The page is long, so never print it whole: search it with Grep and read only the parts that match.

Do this before you name, list or suggest any task, in few steps:

1. Save it: `python3 athena/db.py get pages "Claude Code log" --out /tmp/claude-code-log.md`.
2. See what Claude Code saved lately with one search: Grep `^### ` in that file. Each heading is a note's name and the day it was saved, newest first. Keep the notes saved in the last 3 days (in the Monday plan, the last 5 days).
3. Read only those notes' sections and compare them with her open tasks (`python3 athena/db.py ls tasks --open --fields id,title,notes`, which you may have loaded already).
4. **Finished:** when a note clearly says the same piece of work as an open task is finished, close that task. Read its notes with `python3 athena/db.py get tasks ID`, write new notes to a file that start with `Done. Closed MONTH DAY, YEAR from Claude Code log: ` and one plain sentence saying what the log says was finished, then a blank line and the old notes, and run `python3 athena/db.py set tasks ID --set status=Done --set-file notes=/tmp/notes.txt`. Close only on a clear match: a similar or related piece of work, work in progress, or work built but still waiting on someone does not count. If part of it is done, leave it open and say in one line what is left. Close at most 8 tasks in one run. If more look finished, say how many in one line and leave them for the next run.
5. **Parked:** before you call a task late or overdue, or pick it as the one thing, run one Grep on the log for its key words (several tasks at once, joined with |). If she paused or parked it, leave the task exactly as it is (never drop it, never change its status, priority or due date), but do not push it or call it late.
6. Nothing in the log about a task means nothing changes: treat it as you would have.

In what you write, add a short section "Closed from Claude Code" listing each task you closed this run, with its one plain sentence, so she can reopen any of them. Leave the section out when you closed none.

If the page is missing, or its "Updated" line at the top is more than 7 days old, say so in one line and carry on.
