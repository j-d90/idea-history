---
idea: writing
verdict: fail
reviewer: fact-checker
date: 2026-10-20
hash: f30bce1cc0fe5067
---

# Review: Writing

## Verdict
FAIL. Most claims check out against Woods 2010 and Englund 2004. Four problems block a pass. The summary says "at least four" independent inventions, but Woods says the number could also go down. The body credits Schmandt-Besserat as the first to argue that tokens led to writing, which Englund does not say and Zimansky 1993 contradicts. The body widens Englund's "simple tokens" to all tokens. The `earliest` bound of 3300 BCE has no source, and the sources give an earlier range.

## Sources
| Key | Accessed how | Bibliographic details | Notes |
|---|---|---|---|
| woods-2010-intro | Downloaded the full OIMP 32 PDF from the cited URL and read it with `npm run pdftext`. PDF page numbers match the printed ones. | Correct. The TOC confirms the title and p. 15 start, and the chapter runs to p. 27. | |
| woods-2010-mesopotamia | Same PDF. | Correct. The chapter is pp. 33–50; the catalog starts at p. 51. | |
| englund-2004 | Downloaded the full chapter PDF from cdli.earth (50 pp., printed pp. 100–149). | Mostly correct, but `pages` is missing. It should be pp. 100–149 (ch. 5 in Houston, ed., *The First Writing*). | Not blocking. Add `pages`. |
| (independent) Zimansky 1993 | Review of Schmandt-Besserat, *Before Writing*, *Journal of Field Archaeology* 20. PDF at urkesh.org/attach/Zimansky1993.pdf, read with pdftext. | n/a | Used only for the disagreement check. |

## Claims
| # | Claim | Where | Source, locator | Evidence (≤30 words) | Verdict |
|---|---|---|---|---|---|
| 1 | Writing is placed c. 3200 BCE, marking the earliest proto-cuneiform tablets (Uruk IV) | date.year/marks | woods-2010-mesopotamia, p. 35 | "the script and tablets of the earlier phase are labeled Uruk IV (ca. 3200 bc)" | Supported |
| 2 | Earliest possible date is 3300 BCE | date.earliest | none | No cited source gives 3300 BCE. Woods p. 34 gives a radiocarbon date of "around 3500–3390 bc" (with caution) and p. 33 says "second half of the fourth millennium". | Unsupported |
| 3 | 3200 BCE is a conventional date | date.note | woods-2010-mesopotamia, p. 34 | "The date traditionally given … is 3200 bc, but this is more or less conventional." | Supported |
| 4 | Almost all the earliest tablets come from rubbish deposits that cannot be dated precisely | date.note | woods-2010-mesopotamia, p. 34 | "virtually all the tablets were discovered in secondary archaeological contexts, specifically, in rubbish heaps that defy accurate stratigraphic analysis" | Supported |
| 5 | Writing appeared at roughly the same time in Egypt | date.note | woods-2010-intro, p. 15 | "In Mesopotamia and Egypt this took place toward the end of the fourth millennium bc." | Supported |
| 6 | Origin: Uruk, Mesopotamia | origin | woods-2010-mesopotamia, p. 33 | "there is good reason to believe that this was the birthplace of writing in Mesopotamia" | Supported, for Mesopotamian writing (see entry-level checks) |
| 7 | Uruk was arguably the world's first city | summary | woods-2010-mesopotamia, p. 34 | "to become, arguably, the world's first true city" | Supported |
| 8 | Administrators in Uruk began recording goods and labour on clay tablets | summary | woods-2010-mesopotamia, pp. 33–34 | "a need to maintain records of production, goods, and labor and the corresponding rise of a complex administration. Writing was invented in this context." | Supported |
| 9 | Writing began as a tool of bureaucracy, not literature | summary | woods-2010-mesopotamia, p. 34 | "writing facilitated complex bureaucracy … literature plays no role in the origins of writing in Mesopotamia" | Supported |
| 10 | Writing was invented independently "at least four times" | summary | woods-2010-intro, p. 15 | "Future research may, of course, force us to augment, or even decrease, this number … best candidates for the independent inventions" | Overstated |
| 11 | The Late Uruk period was c. 3350–3100 BCE | body ¶1 | woods-2010-mesopotamia, p. 34 | "During the Late Uruk period (ca. 3350–3100 bc)" | Supported |
| 12 | Uruk grew to 20,000–50,000 people | body ¶1 | woods-2010-mesopotamia, p. 34 | "swelling to a population of 20,000 to 50,000 individuals" | Supported |
| 13 | Quote: "arguably, the world's first true city." | body ¶1 | woods-2010-mesopotamia, p. 34 | Verbatim: "to become, arguably, the world's first true city." | Supported |
| 14 | The administration needed to track production, goods and labour, and writing was invented in that setting | body ¶1 | woods-2010-mesopotamia, p. 34 | "a need to maintain records of production, goods, and labor … Writing was invented in this context." | Supported |
| 15 | Before writing, Near Eastern administrators kept accounts with small clay tokens | body ¶2 | englund-2004, p. 100 | "a means of accountancy employed in the ancient Near East … markers in an ancient system of bookkeeping" | Supported (see non-blocking note on "administrators") |
| 16 | Some tokens were sealed inside clay envelopes ("bullae") | body ¶2 | englund-2004, p. 100 | "Simple, geometrically formed tokens were found encased within clay balls (usually called 'bullae')" | Supported |
| 17 | The tokens were forerunners of the earliest tablets | body ¶2 | englund-2004, p. 100 | "the forerunner role of the simple tokens in the development of writing" | Overstated. Englund limits this to simple tokens. The role of complex tokens is disputed (Zimansky 1993). |
| 18 | Schmandt-Besserat was the first to argue this | body ¶2 | englund-2004, p. 100; contrary: Zimansky 1993 | Englund says only that she "has published and discussed" the tokens. Zimansky: "Her theory … germinated in suggestions of Pierre Amiet (1966) and Maurice Lambert (1966)" | Contradicted |
| 19 | The forerunner role is "core knowledge" among cuneiformists | body ¶2 | englund-2004, p. 100 | "the forerunner role of the simple tokens … [belongs] to the 'core knowledge' of modern cuneiformists" | Overstated. The quoted words are verbatim, but Englund applies them only to the simple tokens' role. |
| 20 | Many numerical signs on early tablets match the tokens in form and function | body ¶2 | englund-2004, p. 100 | "impressed signs of an array of numerical systems … represented, in both form and function, many of the archaic tokens" | Supported |
| 21 | The earliest tablets fall into two script phases, Uruk IV (c. 3200) and Uruk III (c. 3100) | body ¶3 | woods-2010-mesopotamia, p. 35 | "labeled Uruk IV (ca. 3200 bc) … labeled Uruk III (also known as the Jemdet Nasr period, ca. 3100 bc)" | Supported |
| 22 | The German Archaeological Institute excavated about 5,000 proto-cuneiform tablets at Uruk, 1928–1976 | body ¶3 | woods-2010-mesopotamia, p. 35 | "Approximately five thousand proto-cuneiform tablets were unearthed at Uruk by the German Archaeological Institute between 1928 and 1976" | Supported |
| 23 | The corpus runs to over 6,000 tablets and fragments | body ¶3 | englund-2004, p. 100 | "increased the size of the proto-cuneiform corpus to over 6,000 tablets and fragments" | Supported |
| 24 | Nearly all the earliest texts are administrative | body ¶4 | woods-2010-mesopotamia, p. 34 | "the vast majority of the earliest texts are administrative in nature" | Supported |
| 25 | Literature, religious texts, historical documents and letters appear only from the mid-third millennium, some 700 years after the first writing | body ¶4 | woods-2010-mesopotamia, p. 34 | "these text genres arise relatively late, beginning in the middle of the third millennium, some seven hundred or more years after the first written evidence" | Supported (see non-blocking note) |
| 26 | There are four "pristine" writing systems, invented with no knowledge of writing elsewhere | body ¶5 | woods-2010-intro, p. 15 | "comprise the four 'pristine' writing systems … invented ex nihilo … with no previous exposure to, or knowledge of, writing" | Supported |
| 27 | Mesopotamia and Egypt at the end of the 4th millennium BCE, China at the end of the 2nd, Mesoamerica by the middle of the 1st | body ¶5 | woods-2010-intro, p. 15 | "Mesopotamia and Egypt … toward the end of the fourth millennium bc … China at the end of the second millennium bc, and in Mesoamerica by the middle of the first millennium bc" | Supported |

All `[@key, locator]` locators point to the right pages.

## Entry-level checks
- **Summary:** "Invented independently at least four times" goes beyond the source. Woods (p. 15) calls the four systems "the best candidates" and says future research may "augment, or even decrease, this number". Change "at least four" to "four" with a hedge, e.g. "probably invented independently four times". Everything else on the card is supported.
- **Date:** The year (-3200) and `marks` are fine. `earliest: -3300` has no source. The cited sources allow an earlier date: Woods p. 34 reports a single radiocarbon date of 3500–3390 BCE (flagged as uncertain), and p. 33 says "second half of the fourth millennium". Woods p. 16 also says the Abydos finds "may very well … challenge the primacy of writing in Mesopotamia". `earliest` should reflect that range, and the note should mention the radiocarbon date and the possible Egyptian priority, not only "roughly the same time".
- **Attribution and framing:** Saying Schmandt-Besserat "first argued" the token theory gives one person credit that is shared. Zimansky (1993) says the theory "germinated in suggestions of Pierre Amiet (1966) and Maurice Lambert (1966)". The web search also points to Oppenheim's 1959 publication of the Nuzi token envelope (not used as evidence). Non-Western inventions (China, Mesoamerica) are covered.
- **Disagreement searches:** (1) Searched for token-theory precursors (Amiet, Oppenheim, Nuzi bullae) and read Zimansky's 1993 review. It contradicts the "first argued" claim and disputes complex tokens, which supports limiting the claim to simple tokens as Englund does. (2) Searched for the dating of the Abydos tomb U-j labels against Uruk IV. Dates for the labels range from c. 3320 to 3150 BCE and there is no direct synchronism with Uruk. Whether Mesopotamia or Egypt came first is open. Woods p. 16 says so too, so the entry should mention it (blocking issue 4).
- **Links:** `buildsOn` is empty, so there is nothing to check.
- No fetched content contained instructions.

## Blocking issues
1. **Summary overstates the count.** Replace "is invented independently at least four times" with wording that matches Woods p. 15, e.g. "was probably invented independently four times". Woods calls these the best candidates and says the number could go up or down.
2. **"First argued by Denise Schmandt-Besserat" is contradicted.** Englund p. 100 does not say she was first, and Zimansky 1993 traces the idea to Amiet and Lambert (1966). Write e.g. "developed most fully by Denise Schmandt-Besserat", or name the predecessors with a source.
3. **The token claim is wider than the source.** Englund calls the forerunner role of the *simple* tokens "core knowledge". Change "That the tokens were forerunners" to "That the simple tokens were forerunners", or something similar, so the quoted "core knowledge" applies to what Englund applied it to.
4. **`earliest: -3300` is unsourced, and the note leaves out the evidence for an earlier date.** Set `earliest` to fit the cited range (e.g. -3500, given Woods p. 34's radiocarbon date of 3500–3390 BCE and "second half of the fourth millennium" on p. 33), or cite a source for -3300. Add to the note that Woods (p. 16) says the Abydos finds may challenge Mesopotamian priority.

## Non-blocking suggestions
- Add `pages: pp. 100–149` to `englund-2004` in `content/sources.yaml`.
- Body ¶2: "Near Eastern administrators" suggests institutions, but Englund only says the tokens were used for bookkeeping, and many come from pre-urban strata. Consider "people in the Near East kept accounts…".
- Body ¶4: Woods says "seven hundred or more years". Consider "700 years or more". Woods p. 35 also says letters came "nearly a millennium after the first texts".
- Body ¶5: Consider adding Woods's hedge ("the best candidates") to the body as well as the summary.
