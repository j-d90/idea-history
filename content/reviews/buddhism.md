---
idea: buddhism
verdict: fail
reviewer: fact-checker
date: 2026-10-20
hash: d6c5f40ad298c6f5
---

# Review: Buddhism

## Verdict
FAIL. The dating material checks out against the sources. But the summary states as fact that the Buddha set out the Four Noble Truths in his first sermon, which the body itself calls only traditional, and it ignores scholarship arguing that the four-truths formula in SN 56.11 is a later layer. No cited source supports the name "Siddhartha Gautama" in `origin`.

## Sources
| Key | Accessed how | Bibliographic details | Notes |
|---|---|---|---|
| sn-56-11 | WebFetch of the Access to Insight URL | Correct: Thanissaro Bhikkhu translation, Access to Insight, ©1993. | Only the page's summary tooltip calls it "the Buddha's first discourse". The translation calls dukkha "stress", so "suffering" is a paraphrase. |
| cousins-1996 | Crossref metadata for the DOI. Full text from the author-sanctioned reproduction on the INDOLOGY site (indology.info/papers/cousins/, sections 1, 4 and 6), fetched from the Internet Archive with `curl` (2005 snapshot). | Correct: L. S. Cousins, JRAS 6(1), 57–63, 1996, DOI 10.1017/S1356186300014760. The reproduction gives "Series 3, 6.1 (1996): 57-63". | The reproduction has no page numbers, so the printed page of the quoted conclusion could not be confirmed. |
| violatti-2015 | WebFetch of the OpenLearn URL | Author, title and container are correct. The page says it first appeared on Ancient.eu on 24 July 2015 and was updated on 11 Feb 2020. | A `reference` source. It is fine for describing what each chronology says. It never names Siddhartha, never says where the Buddha lived, and never mentions the first sermon. |

## Claims
| # | Claim | Where | Source, locator | Evidence (≤30 words) | Verdict |
|---|---|---|---|---|---|
| 1 | The founder is Siddhartha Gautama | origin | none | No cited source uses the name. Violatti says only "the Buddha" and "the historical Buddha". | Unsupported |
| 2 | The founder is called the Buddha | origin | sn-56-11; violatti-2015 | "the Blessed One"; "the historical Buddha" | Supported |
| 3 | Origin in northern India | origin | sn-56-11 (setting) | "staying at Varanasi in the Game Refuge at Isipatana". Varanasi is in northern India, but no source says this in words. | Supported (weakly, by implication) |
| 4 | The first sermon was given near Varanasi | summary | sn-56-11 | "staying at Varanasi in the Game Refuge at Isipatana" | Supported |
| 5 | It was "his first sermon", stated as fact | summary | sn-56-11 (summary tooltip only) | "This is the Buddha's first discourse." The body itself says "traditionally". | Overstated |
| 6 | In it the Buddha sets out the Four Noble Truths | summary | sn-56-11 | The sutta contains four "noble truth" passages. Whether this formula belongs to the earliest teaching is disputed (see Entry-level checks), and the body never mentions the four truths. | Overstated |
| 7 | Suffering arises from craving | summary | sn-56-11 | "the noble truth of the origination of stress: the craving that makes for further becoming" | Supported |
| 8 | Suffering ends when craving is let go | summary | sn-56-11 | "the remainderless fading & cessation, renunciation, relinquishment, release, & letting go of that very craving" | Supported |
| 9 | The date marks the Buddha's death, with his teaching in the preceding decades | date.marks | cousins-1996 §4 | "the Buddha's period of teaching activity was in the second half of the fifth century B.C." | Supported |
| 10 | Placement year about 400 BCE | date.year | cousins-1996 §6 | "we should no doubt speak of a date for the Buddha's Mahaparinibbana of c.400 B.C" | Supported |
| 11 | earliest −486 | date.earliest | violatti-2015 | "moved the date of the Buddha's death to 487 or 486 BCE" | Supported |
| 12 | latest −368 | date.latest | violatti-2015 | "the Buddha died on 370-368 BCE". The symposium range runs to 261 BCE (see Non-blocking suggestions). | Supported |
| 13 | Traditional Theravada date of 544/543 BCE | date.note; body | violatti-2015 | "The Theravada tradition claims that the death of the Buddha occurred in 544 or 543 BCE" | Supported |
| 14 | A corrected version gives 487/486 BCE, from checking against Ashoka's reign | date.note; body | violatti-2015 | "dates for Emperor Ashoka in the long chronology are miscalculated by around 60-70 years" … "moved the date … to 487 or 486 BCE" | Supported |
| 15 | The Indian "short chronology" gives 370–368 BCE; "Indian sources point to" it | date.note; body | violatti-2015 | "attested by Indian sources and their Chinese and Tibetan translations" … "370-368 BCE" | Supported |
| 16 | There was a 1988 symposium on the question in Göttingen | date.note; body | violatti-2015; cousins-1996 §1 | "In 1988 CE a symposium … took place in Gottingen". Cousins says "near Göttingen in 1988". | Supported |
| 17 | Experts proposed dates from 486 to 261 BCE | body | violatti-2015 | "The dates proposed by a group of experts who attended goes from 486 BCE to 261 BCE" | Supported |
| 18 | Cousins reviewed the published volumes | body | cousins-1996 §1 | "The volumes reviewed here stem from a conference held near Göttingen in 1988" | Supported |
| 19 | Quotation "the evidence seems to favour … c.400 B.C." | body; date.note | cousins-1996 §6 | Verbatim match. The reproduction lacks the final period of "B.C.", which is typographic. | Supported |
| 20 | SN 56.11 is traditionally the first sermon | body | sn-56-11 | "This is the Buddha's first discourse." | Supported |
| 21 | It was delivered at Isipatana near Varanasi | body | sn-56-11 | "at Varanasi in the Game Refuge at Isipatana" | Supported |
| 22 | Quotation "the craving that makes for further becoming" | body | sn-56-11 | Verbatim | Supported |
| 23 | Quotation "the remainderless fading & cessation … of that very craving" | body | sn-56-11 | Verbatim | Supported |
| 24 | buildsOn: none | buildsOn | — | No links to check | n/a |

## Entry-level checks
- **Summary.** The card says "In his first sermon … the Buddha sets out the Four Noble Truths". It drops the body's "traditionally" and turns a canonical attribution into historical fact. The body quotes only two of the four truths and never uses the phrase "Four Noble Truths", so the card says more than the body.
- **Date.** Placing it at −400 is well supported by Cousins. `marks` is accurate. `earliest` −486 matches the corrected long chronology, the upper end of the symposium range. `latest` −368 matches the short chronology but stops short of the symposium's 261 BCE outlier (Eggermont, per Cousins §4). Cousins says no other contributor proposes a date after 380 BCE, so the range is defensible.
- **Attribution and framing.** The dating section is balanced and covers Theravada, Indian/Chinese/Tibetan and modern scholarly chronologies. The teaching section treats the canonical text as a record of the Buddha's own first words without saying that this is the tradition's view.
- **Disagreement searches.**
  - Search: "Cousins median chronology c.400 B.C." This found the reproduction, plus forum leads saying the c. 400 BCE date rests heavily on Härtel's archaeology and that some, e.g. Narain, favour about 480 BCE. The entry's range already covers that, so it is not blocking.
  - Search: the authenticity of the Four Noble Truths in the first sermon. K. R. Norman, "The Four Noble Truths: A Problem of Pali Syntax" (in *Indological and Buddhist Studies … J. W. de Jong*, Canberra 1982, 377–391; repr. *Collected Papers* II, 210–223), concluded that the earliest form of this sutta did not contain the word *ariya-sacca* ("noble truth"). Others go further and argue the four-truths content itself is a later addition. I know of Tilmann Vetter, *The Ideas and Meditative Practices of Early Buddhism* (1988), as a lead for this view, but did not consult it. I saw Norman's argument only in secondary summaries.
  - This is a real scholarly dispute about exactly what the summary states as fact, so it is blocking.
- **Links.** `buildsOn` is empty, so there is nothing to check.
- **Disallowed sources.** None are cited. No fetched page contained instructions.

## Blocking issues
1. **The summary overstates (claims 5–6).** Rewrite the card so the first-sermon attribution is marked as traditional. For example: "In what tradition holds was his first sermon, near Varanasi, the Buddha sets out…". Also either hedge the "Four Noble Truths" framing or support it in the body.
2. **Scholarly disagreement is ignored.** Add a sentence to the body, citing secondary scholarship you have actually consulted (e.g. Norman 1982 and/or Vetter 1988), saying that scholars dispute whether the four-noble-truths formula in SN 56.11 belongs to the earliest teaching. Add each new source to `content/sources.yaml`.
3. **`origin` is unsupported (claim 1).** No cited source names "Siddhartha Gautama". Either cite a source that gives the personal name and his region (a scholarly or reference work on the Buddha's life), or change `origin` to "the Buddha; northern India (Varanasi)".

## Non-blocking suggestions
- Add a locator to the Cousins citation: the conclusion, "In conclusion", the final section of pp. 57–63, probably p. 63. Verify the page against the printed article.
- Consider saying in the note that the latest symposium proposal, 261 BCE, was an outlier (Eggermont), so the `latest` of −368 doesn't seem to contradict the body's "486 to 261 BCE".
- The sources say the symposium was held "near" Göttingen (Cousins) or "in" Göttingen (Violatti). Either wording is acceptable.
- Consider adding "Series 3" to the cousins-1996 entry and noting in violatti-2015 that the article was first published on Ancient.eu.
- The body's "suffering" glosses Thanissaro's "stress". You could note the translation choice.
