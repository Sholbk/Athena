## LinkedIn comments

This run drafts comments for Stephanie to post by hand on LinkedIn. The job's own instructions above say who she wants to be seen by and how she sounds. This section is the method. Nobody is watching: never ask a question, never wait. Where a decision is hers, say so in the brief.

Your tools, run from the current folder:

    python3 athena/linkedin.py people
    python3 athena/linkedin.py comments
    python3 athena/linkedin.py prune
    python3 athena/linkedin.py scan --out /tmp/scan.json --cap 1.00
    python3 athena/linkedin.py add --person ID --link POST_URL --date YYYY-MM-DD --summary "..." --comment-file /tmp/c1.txt [--tier2]

`people` lists everyone she watches, highest score first, with tier, stage and notes. `comments` lists every draft on the desk, including the ones she already posted (posted_at set). `scan` reads each person's newest public posts through Apify and saves them to the file (never print that file whole, read it with Read). `add` puts one draft on the desk and refuses a comment that breaks the rules below, so read its message and fix the draft rather than forcing it.

Your only writes are `prune`, `add`, and the brief you hand back. Never write anywhere else, never comment, like, follow, connect or message on LinkedIn, and never touch Apify beyond the one scan.

### Steps

1. `prune`, then `comments`, then `people`. Count the staged comments (kind "staged", posted or not) to get the batch count. If it has reached the batch target, put "Batch complete" at the top of the brief and stage no more tier 1 comments.
2. `scan` once, with the cap from the instructions. If it says Apify is not connected or the run failed, say so plainly at the top of the brief, keep the carried-over comments, and finish the brief without new ones.
3. For each person with posts, pick the best post: the most recent one where they say something about their own work or point of view. Skip job postings, logistics-only announcements, pure reposts, and anything about politics, health claims or a named client. Use posts from the last 7 days. If that gives fewer than 4 comments in all (new plus carried over), widen to 14 days. Highest score first.
4. Skip any post already on the desk (same post_key in `comments`), and skip anyone who already has a comment posted in the last 3 days unless they have a different, newer post.
5. Stage up to the run's tier 1 limit, highest score first, and up to the tier 2 limit with `--tier2`. If more qualify, the rest wait for the next run. A second post by the same person may get its own comment, so she has two to post over the week.
6. Write each comment to a file under /tmp, then `add` it. Keep the summary to 1 or 2 sentences in your own words, no quotes from the post.
7. Hand back the brief. The app saves it as the page "LinkedIn comments" and shows it on the Comment desk. Comments already carried over stay on the desk as they are: never rewrite them.

### Comment rules

- 2 to 4 sentences, about 250 characters or more, plain text she can paste.
- Lead with a point of view about the topic. Give one plain reason for it. Then at most one light closing question. The comment shows thought, not only a question.
- Talk about the subject, never about the person. Do not restate their post back to them, and do not tell them what they did, wrote, hold as a title or achieved.
- No framing phrases such as "my take is", "I think", "in my opinion". State the view. "I agree, and ..." is fine when the post is a statement.
- Simple words. No jargon, no shorthand, no metaphors. Name the concrete thing.
- Never congratulate or praise. Never mention ColibriOS, a product, a pitch, a meeting or a trial. Never include a link. Never ask to connect.
- Never claim an experience, event, number, study or result Stephanie cannot honestly say. Use no statistic unless the post itself states it. The point of view is a general craft observation tied to the post's subject, not an invented story.
- No em dashes, no en dashes, no semicolons. Facts come only from the post.

### The brief

Markdown, short, in this order:

1. One line: new comments today, comments waiting from earlier runs, and minutes needed (1 a comment). "Batch complete" first if the batch is full. If Apify was not connected or the scan failed, say that here.
2. One block per person with a new comment, grouped under the company name when two people share one: name and title, the post link, the post date, the summary, then the comment text exactly as staged. If one person got two comments, add "Post one now and the other in a few days."
3. "Ready to connect": people with a posted comment at least 1 day old and within the last 14 days, from `comments` and `people`, with their profile link. "Nobody yet" if none.
4. "Not active on LinkedIn": everyone scanned with no qualifying post, one line each, with a colleague's name when someone else at the same company did post.
5. "Skipped": each person or post you skipped and why, one line each.
6. If the pool is exhausted (nobody left with a qualifying post), say so plainly and suggest what she could do: add more people to watch, or add tier 2 people.
7. Last lines: new comments staged, comments carried over, posts found, Apify cost (the run's cost_usd when present, otherwise the estimate, marked as such), and anything skipped and why.

Dates as "Oct 17". No em dashes anywhere. Never print a person's post text in full in the brief, the summary is enough.
