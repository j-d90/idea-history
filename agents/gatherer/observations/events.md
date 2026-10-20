## Observation type: events

An **event** is something that happened at an identifiable time and place, as sources record it. Examples:
- a ruler's accession or death
- a battle, campaign or treaty
- the founding, destruction or abandonment of a city
- the building of a monument
- the issuing of a law or decree
- a migration, flood or famine

Each event must be specific enough that a source could date it, even roughly.

Not events:
- **Long processes** ("urbanization", "the spread of bronze"). Record the datable occurrences that evidence them instead (the earliest known tin-bronze objects at a site, the founding of a city).
- **Ideas, beliefs or institutions as such.** Record the occurrence that attests them (the earliest text naming a god, the inscription recording a reform). Other agents identify ideas from events; your job is the observation, stated neutrally.
- **Undated archaeological phases.** Only include a phase if a source gives it dates and you record what the dates mark.

For each event:
- **title**: short and neutral, naming who and what. "Eannatum of Lagash defeats Umma", not "The first great war".
- **kind**: the closest of the allowed kinds.
- **place**: short. The site, with its modern location when the source gives one ("Girsu (modern Tello, Iraq)"). Put other details in the summary.
- **summary**: one or two sentences, at most 320 characters. No citations in the summary.
- **Dates**:
  - `year`: the placement year, which must fall within the period you were given. Negative years are BCE; there is no year 0.
  - `date_marks`: what the year marks, including the chronology it rests on ("Conventional date of Eannatum's reign, middle chronology").
  - `earliest` / `latest`: the range of scholarly estimates when sources give one.
  - `approx`: true when the date is approximate, which is almost always the case before about 1000 BCE.
  - `date_note`: chronological disagreement worth telling readers, in plain words (no citations).
- **citations**: at least one, each with a verbatim excerpt from that source. Use several when one source gives the event and another the date.

**Every claim must be in your excerpts.** The fact-checker's batch check compares the title, place, summary and every date field against your excerpts, and nothing else. A detail you read but didn't quote fails the check, even if it's true: a material, a site name, a date range, a chronology note. So either quote a passage that states it (several short excerpts are fine), or leave it out. Plain conversions (years ago to BCE) and a named site's modern country are allowed.
- **entities**: the people, places, polities, works (inscriptions, monuments, texts) and groups involved, with their roles. Call `find_similar_entities` first and reuse existing entities.
### Prehistoric dates

Before writing, dates come from radiocarbon, luminescence, uranium-series, argon-argon and similar methods, usually given as "years ago", "ka" (thousands of years ago), "Ma" (millions of years ago) or "cal BP".
- **Convert them to years.** For "N years ago" or "N ka", the year is about −N (for example, "73,000 years ago" becomes −71,000 to −73,000; pick −71,000 and set approx). For "cal BP", use year = 1950 − N (so 11,600 cal BP is −9650).
- **Keep the source's own figure in `date_marks`**, with the method: "about 73,000 years ago (OSL dating of the layer)". Turn an error range ("± 4,000") into `earliest` / `latest`.
- **Events with no exact moment** still need dating. A find dated by its layer is fine: record what happened there (people engraved this ochre at Blombos Cave), dated as the source dates it.
- **Watch for "earliest" claims.** In prehistory they change with each excavation, so use one only when your excerpt says it, and prefer the source's own hedging ("among the earliest known").

- **existing_id**: if `find_similar_events` shows the event is already in the graph, set this to its id. Give only what you're adding: new citations, aliases or entities. Don't record it again.
