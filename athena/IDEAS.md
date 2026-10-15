## Finding ideas

When she asks you to find new idea bank seeds on colibrios.com, read her public site and add new seeds to the idea bank. The seeds are angles for posts, grounded in what the site really says.

Your tools for this, besides db.py:

    python3 athena/ideas.py list
    python3 athena/ideas.py add --pillar "PILLAR HEADING" --text "THE SEED"
    python3 athena/site.py pages
    python3 athena/site.py read PATH --out FILE

1. Run `python3 athena/ideas.py list` to see the pillars, every seed and the Used list.
2. Read the page "Site pages read" (folder Athena) if it exists, to see which site pages were read before and when.
3. Run `python3 athena/site.py pages`. Pick up to 6 pages that have not been read yet. Good pages are:
   - the home page, /pricing and /savings
   - the "for" pages (/for/...)
   - the comparison pages (...-alternative)
   - the software pages and the blog posts
   Skip /contact, /watch and /blog itself. When every page has been read, take the ones read longest ago.
4. Save each page with `python3 athena/site.py read PATH --out /tmp/site-N.txt`, then read the file.
5. Read "ColibriOS Brand Files" for the pillars, "Brand voice" and "My person": `python3 athena/db.py get pages "ColibriOS Brand Files"`.
6. Write at most 8 new seeds in all.
   - **Style:** match the seeds already there. Start with a short name for the angle, then one or two sentences on what the post should do.
   - **Grounding:** each seed is built on one real thing a page says, such as a feature, a comparison, a cost, or a problem it names.
   - **Source:** end each seed with "(From colibrios.com/PATH)".
   - **No repeats:** don't add a seed that repeats one already in the bank or the Used list, even in other words.
   - **No people:** never name a real person.
   - **Numbers:** put in a price or number only when the page states it, and never invent one.
   - **Dashes:** never use an em dash or en dash.
7. Add each seed with `ideas.py add`, using the pillar heading exactly as `list` prints it, under the pillar it fits best. `add` numbers the seed itself, and it refuses a seed that is too close to one already there. If it refuses, drop that seed.
8. Update "Site pages read" with one line per page you read, such as `- /dubsado-alternative: Oct 15, seeds 28 and 29` or `- /about: Oct 15, nothing new`. Write the whole page to a file under /tmp, then save it with `python3 athena/db.py set pages "Site pages read" --set-file body=/tmp/read.md`. The first time, use `python3 athena/db.py new pages --set title="Site pages read" --set folder=Athena --set-file body=/tmp/read.md`.
9. Reply in one or two lines: how many seeds you added, their numbers, and which pages they came from.
