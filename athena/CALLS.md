## Her calls

Her recorded calls are pages in the folder "Meetings". Each title starts with the call's date, like "2026-10-13 Call name". List them with:

    python3 athena/db.py ls pages --where folder=Meetings --fields id,title

The page "Calls read" (folder Athena) lists every call already turned into tasks, one exact title per line. If it does not exist yet, create it.

When you are asked to add her to-dos from her calls:

1. Take the calls that are not on "Calls read", oldest first, at most 6 in one run. If more are waiting, leave them for the next run and say how many in one line.
2. Save each call with `python3 athena/db.py get pages ID --out /tmp/call.md` and read its "Next Steps" section (sometimes called Action Items or Follow-ups). Read the transcript only when that section is missing or unclear. Never print a whole call: it holds other people's words.
3. Keep only what Stephanie will do: items with her name, or "I" and "me" when she was the one speaking. Skip what other people agreed to do.
4. Before adding a task, look for an open one with the same meaning (`python3 athena/db.py ls tasks --open --fields id,title,notes`). If there is one, update it and add the call line to its notes.
5. A new task gets a short title that starts with a verb, status Not started, source Meeting, a bucket, a client (None when it is not client work) and priority This week. Set due only when the call named a date that is today or later. Otherwise leave due empty and put any date that was said in the notes. Notes always start with "From call: " and the call's exact title.
6. Add all of one call's tasks in one Bash command, joining the db.py calls with `;`, then check that each one worked.
7. Add the call's exact title to "Calls read", even when it had nothing for her.

Whatever else you were asked to write still comes first. If a call cannot be read, skip it, leave it off "Calls read" and say so in one line.
