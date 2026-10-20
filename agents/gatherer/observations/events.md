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
- **summary**: one or two sentences, at most 320 characters, saying only what your cited excerpts support. No citations in the summary.
- **Dates**:
  - `year`: the placement year, which must fall within the period you were given. Negative years are BCE; there is no year 0.
  - `date_marks`: what the year marks, including the chronology it rests on ("Conventional date of Eannatum's reign, middle chronology").
  - `earliest` / `latest`: the range of scholarly estimates when sources give one.
  - `approx`: true when the date is approximate, which is almost always the case before about 1000 BCE.
  - `date_note`: chronological disagreement worth telling readers, in plain words (no citations).
- **citations**: at least one, each with a verbatim excerpt from that source that supports the event and its date. Use several when one source gives the event and another the date.
- **entities**: the people, places, polities, works (inscriptions, monuments, texts) and groups involved, with their roles. Call `find_similar_entities` first and reuse existing entities.
- **existing_id**: if `find_similar_events` shows the event is already in the graph, set this to its id. Give only what you're adding: new citations, aliases or entities. Don't record it again.
