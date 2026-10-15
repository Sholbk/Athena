## Image prompts

The page "Image prompts" (folder Athena) holds two ready-to-paste prompts for each idea bank seed: one for ChatGPT, which makes the picture, and one for Claude, which designs the graphic. The Idea bank on her Marketing page reads this page, so keep its format exactly as below.

When she asks for image prompts:

1. Read the page "ColibriOS Brand Files": the seed itself, "Brand look" (colors with hex codes, type, feel), "Brand voice", "My person" and "Offer" for the one call to action. Every prompt carries the brand look.
2. Write for the seeds she named. "Every seed without prompts" means each numbered seed in the Idea bank, not the Used list, that has no section on "Image prompts" yet. Do at most 12 seeds in one run, lowest numbers first, and say how many are left.
3. The ChatGPT prompt asks for one picture for an Instagram feed post, portrait 4:5, 1080 by 1350 pixels. Describe one concrete scene that shows the seed's idea: the setting, the light, the palette with hex codes, the mood. Follow the brand look, so it feels like a real photo in warm natural light, never like stock. No words, logos or app screens in the picture. End with: "If I attach one of my photos, build the image around it and keep me looking like me."
4. The Claude prompt asks for a finished graphic: a carousel of 3 to 5 slides or a single quote card, whichever suits the seed. Write out the words for every slide in her voice: the hook first, the point, and a last slide with the one call to action. Ask for each slide as a downloadable PNG at 1080 by 1350 pixels, made with code. Give the colors with hex codes. Headlines in Canela, or a refined serif such as Cormorant Garamond when Canela is not available, and body text in Inter.
5. Never invent numbers, results or testimonials in either prompt. When a seed names a real person, end the Claude prompt with a reminder that their yes comes before it posts.
6. Each seed gets this section on the page, in seed number order: a heading line "## Seed N", a line "**ChatGPT**", the ChatGPT prompt inside a fenced code block, a line "**Claude**", then the Claude prompt inside a fenced code block. The page starts with "# Image prompts" and one line saying what it is. Keep the sections already there, except a seed she asked to redo: replace that one.
7. Write the whole page to a file under /tmp with the Write tool, then save it in one command: `python3 athena/db.py set pages "Image prompts" --set-file body=/tmp/prompts.md`, or the first time `python3 athena/db.py new pages --set title="Image prompts" --set folder=Athena --set-file body=/tmp/prompts.md`.
8. Reply in two or three lines: which seeds now have prompts, and how many are left.
