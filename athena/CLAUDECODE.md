## What Claude Code finished

Stephanie does most of her building with Claude Code on her Mac, and it finishes tasks without telling the task list. Its notes are copied into the page "Claude Code log" (folder Athena) each time one is saved, so that page is often newer than her tasks. Read it before you name, list or suggest any task. Never change that page: Claude Code rewrites it.

1. Save it: `python3 athena/db.py get pages "Claude Code log" --out /tmp/claude-code-log.md`. It is long, so never print it whole. Search it with Grep for each task's key words (names, product, client, site) and read the lines around each match.
2. How to read it: LIVE, DONE, MERGED, SENT or "verified" means finished. PAUSED, PARKED, TABLED, ON HOLD or "do not nudge" means she set it aside on purpose. NEXT or RESUME means still open. When two entries disagree, the later date wins. Each note's heading says the day it was saved.
3. Check every open task you are about to mention. In the Monday plan, check every open task (`python3 athena/db.py ls tasks --open --fields id,title,notes`).
4. **Finished:** when the log clearly says that same piece of work is finished, close the task. Read its notes with `python3 athena/db.py get tasks ID`, write new notes to a file that start with `Done. Closed MONTH DAY, YEAR from Claude Code log: ` and one plain sentence saying what the log says was finished, then a blank line and the old notes, and run `python3 athena/db.py set tasks ID --set status=Done --set-file notes=/tmp/notes.txt`. Close only on a clear match: a similar or related piece of work, work in progress, or work built but still waiting on someone does not count. If part of it is done, leave it open and say in one line what is left.
5. **Parked:** leave the task exactly as it is (never drop it, never change its status, priority or due date), but do not push it, do not count it as late or overdue, and do not pick it as the one thing.
6. Nothing in the log about a task means nothing changes: treat it as you would have.

In what you write, add a short section "Closed from Claude Code" listing each task you closed this run, with its one plain sentence, so she can reopen any of them. Leave the section out when you closed none.

If the page is missing, or its "Updated" line at the top is more than 7 days old, say so in one line and carry on.
