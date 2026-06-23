# The RMBL Knowledge Commons: A Guide for the Research Community

*What the platform offers, how to use it in your work, and how it stays trustworthy*

*Last updated: June 2026*

---

## 1. What the Knowledge Commons is

The Rocky Mountain Biological Laboratory has produced knowledge about the Gunnison Basin for nearly a century. That knowledge has always been scattered: peer-reviewed papers across hundreds of journals, theses and student work, datasets in a dozen repositories, community and policy documents, and decades of regional reporting. Each is valuable alone, but the connections between them — the fact that a dataset underpins a paper, that a county planning document cites the same field site, that two research groups have been quietly working on adjacent questions — have been effectively invisible.

The Knowledge Commons makes those connections visible. It is a single, searchable platform that brings this material together and surfaces the relationships *between* the pieces. For a working researcher, that turns into practical capabilities: faster and more complete literature discovery, a way to find the datasets and methods behind a body of work, a map of who is doing what across the basin, and a grounded view of where the open questions and frontiers lie.

At present the Commons holds roughly:

- **4,852 publications** — peer-reviewed articles, theses, and student papers
- **1,769 documents** — community and policy material, plus 388 Federal Register notices (1995–2025) for the regulatory context
- **1,426 datasets** — research data from eight discovery sources
- **841 stories** — regional news coverage
- **7,512 authors** — a deduplicated, cross-collection registry of people
- **118 projects** and a rich layer of **entities**: 4,334 species, 8,225 places, 1,474 protocols, 3,607 concepts, and 5,823 stakeholders
- **146 research neighborhoods** and **166 frontiers** (68 paper-grounded with verbatim source-paper cites + currency tracking, 98 legacy)
- **151,746 references** and **151,728 entity mentions** linking it all together

It is worth knowing the platform's founding principle, because it shapes the experience: the Commons serves two audiences with equal weight — the professional research community and the public. As a researcher you get specialist tools (citation export, a programmatic API, semantic search, gap-finding), but you'll also notice the interface stays legible to non-specialists. That's deliberate, and it means the same record you cite in a grant is also discoverable by a land manager or journalist.

You can reach everything described here at **https://rmblknowledgecommons.org**.

---

## 2. What's in it: content and entities

Everything in the Commons is one of two kinds of thing.

**Content** is what you'd recognize as a "thing to read or download": a publication, a document, a dataset, a news story. Each lives in its own collection with type-appropriate metadata — publications carry authors, abstracts, DOIs, and citation data; datasets carry creators, repositories, licenses, and methods; documents carry their authoring organizations and policy topics.

**Entities** are the recurring concepts that thread through all that content: *species* (e.g., the yellow-bellied marmot), *places* (e.g., Gothic, Colorado), *protocols* (standardized research methods), *concepts* (abstract scientific ideas), and *stakeholders* (agencies and organizations). Entities aren't documents you read — they're the shared vocabulary the documents have in common.

The reason this matters for your work: when a publication, a dataset, and a story all reference the same place and species, the Commons records those links. With nearly a hundred thousand such links, you can ask questions that no single document answers — *what methods are used to study this species, which datasets support this line of work, who has worked at this site across decades* — and get answers from the structure connecting the literature, not from any one paper.

The rest of this guide walks through the four things you'll actually *do*: **search**, **follow connections**, **see the big picture**, and **take the data with you** — followed by how the Commons is curated and how you can help keep it accurate.

---

## 3. Finding what you need: search

Search is the front door, at **/search**. Two things make it more powerful than a typical library search box.

### Keyword and semantic search, combined

The Commons runs two kinds of search at once and blends the results.

**Keyword search** is the familiar kind: it finds records containing the words you type, with titles weighted above abstracts and abstracts above full text. Use it when you know the exact terminology — a species name, an author, a specific method.

**Semantic search** is the difference-maker. Every record is represented by a numerical "embedding" that captures its *meaning*, so records about similar topics are findable even when they share little vocabulary. A search for "flower blooming times" will surface a paper titled "phenological shifts in subalpine forbs" because the two are conceptually close, not because they share words. Use it when you're exploring a topic rather than hunting a known item, or when a field uses several different vocabularies for the same idea.

Because the platform blends both, you get precision when you're specific and recall when you're exploratory — without having to choose a mode. In practice: search the way you'd describe the topic to a colleague, and the semantic layer will bridge terminology gaps that a pure keyword search would miss.

### Faceted filtering

Results can be narrowed by type (publication, dataset, document, story), and the browse pages for each collection add their own filters — species by kingdom, places by whether they're referenced or merely cataloged, protocols by whether they're standardized, concepts by type, stories by classification and date. This lets you move quickly from a broad query to a focused set.

### Entity knowledge cards

When your search matches a recognized entity — a species, a place, a concept — the results can include a **knowledge card** summarizing that entity and linking to its dedicated page. This is a fast way to pivot from "documents mentioning X" to "everything we know about X," which is often where the more interesting exploration begins.

### A note on news stories

News stories are fully searchable — their text is indexed so they surface in results — but the full text is **not displayed** on the site for copyright reasons. You'll see the story's metadata, classification, and entity links, and a path to the original source, rather than a reproduction of the article.

---

## 4. Following the connections

Once you've found a record, the detail pages are built to keep you moving along the threads of the literature rather than dead-ending.

### Content detail pages

Each publication, dataset, document, and story has a detail page with its full metadata, abstract or description, and — importantly — its place in the network. For publications you'll find authors (linked to their profiles), the references it cites and the works that cite it (where known), linked datasets, and the entities it mentions. For datasets you'll find creators, repository and license information, and any publications that use the data. The aim is that every page is a hub, not a terminus.

### Related works

Every content page offers **related works**, and the relatedness is computed from four distinct signals rather than one:

1. **Semantic similarity** — records whose meaning is close to this one.
2. **Shared entities** — records that discuss the same species, places, protocols, or concepts.
3. **Co-authorship** — works connected through shared authors.
4. **Citations** — works linked through the citation network.

Because these are different signals, the related set surfaces neighbors a single method would miss — a dataset that shares your study system, a paper by the same group on a different topic, a work you cite in common with another. This is one of the most useful features for literature review and for finding the adjacent work you didn't know to look for.

### Author profiles

Each author has a profile (**/authors/[id]**) gathering their works across all collections, their frequent co-authors, and the projects they're associated with. Authorship is deduplicated and ORCID-enriched, so an author's record pulls together their output even when their name appears inconsistently across sources. This is a quick way to understand a research group's footprint or to find the right person behind a method or dataset.

### Entity pages

The entity collections each have browse pages and detail pages. A **species** page shows external taxonomic links (validated against ITIS), co-occurring species, and the works that mention it. A **place** page shows its coordinates on a map, its position in a geographic hierarchy, and the linked works. **Protocol** and **concept** pages show co-occurring entities — what methods and ideas tend to appear together — which is a genuinely novel way to navigate: from a method to the questions it's used for, or from a concept to the species and places where it's studied.

### Local knowledge graphs

Most detail pages include an interactive **local knowledge graph** — a small, navigable network centered on the current record, showing its immediate connections. It's a visual, exploratory complement to the lists: you can see at a glance how densely a topic is connected and click outward into the neighborhood. These are rendered to handle large networks smoothly, so you can pan and expand without the page bogging down.

---

## 5. Seeing the big picture: explore, neighborhoods, and frontiers

Beyond individual records, the Commons offers a set of higher-order views that are particularly useful for orientation, synthesis, and grant development.

### Explore views

The **/explore** section provides graph visualizations across the whole corpus: per-entity-type networks (species, concepts, protocols, places, authors, publications, datasets), a combined unified graph spanning all types, and a neighborhood-colored view of the whole network. There's also a **places map** plotting geolocated sites across the basin. Several of these support a research-only mode that excludes community documents, if you want to see the scholarly network on its own. These are the right tools when you want to understand the *shape* of a field rather than read a specific paper.

### Research neighborhoods

The platform detects clusters of tightly-connected work — recognizable research communities of people, species, places, and concepts that belong together as a line of inquiry — and identifies about **146 neighborhoods**. Each has a detail page (**/neighborhoods/[id]**) with its members and a **primer**: a readable synthesis of what that community studies, who its key contributors are, and what its open questions appear to be. For someone new to a subfield — an incoming student, a researcher moving into a new system — a neighborhood primer is a fast, grounded orientation. For someone established, it's a way to see your own area from the outside and spot adjacent communities.

### Frontiers

Perhaps the most distinctive view for the research community is **/frontiers**. Each entry is a paper-grounded articulation of a knowledge boundary — a recurring open question across the literature, with **every key question and data gap tied to a verbatim quote from a primary paper you can open and read for yourself**. The platform currently shows **68 grounded frontiers** by default (98 earlier legacy frontiers remain accessible via the *Include legacy* filter).

Each frontier carries key questions with inline cite chips (hover or click to see the source-paper snippet that grounds the claim), data gaps with the same provenance, and a per-question **currency** tag — the LLM periodically rechecks each open question against newer papers in the same neighborhoods to flag whether it's been *addressed*, *partially addressed*, or remains *open*. Contributing neighborhoods and primary-citation counts are surfaced on the index card so you can scan for breadth.

This is deliberately pitched at the level a research program or a funding proposal operates on: not "this paper left a question open" but "across many research communities, here is a recurring frontier, here are the questions it raises (with the exact source sentences), and here are the data gaps standing in the way." If you're writing a grant, scoping a new project, or arguing for why a line of work matters, the frontiers layer is built to support exactly that kind of thinking — and because every claim cites a paper verbatim, you can drill straight from a high-level frontier to the source sentence and decide whether the synthesis reads true.

---

## 6. Taking the data with you

The Commons is built to feed your existing workflow, not to trap you inside a website.

### Citation export

Any publication or dataset can be exported in standard formats — **RIS** and **BibTeX** — for direct import into Zotero, EndNote, Mendeley, or a LaTeX bibliography. You can also export the results of an entire search at once, which makes it straightforward to seed a reference library for a review from a single well-constructed query.

### A programmatic API

For anything beyond point-and-click, there's a versioned REST API at **/api/v1**. It exposes search, full publication/dataset/document records (with authors, entities, and citations), author profiles, entity browse and detail, related works, neighborhoods, and frontiers. Responses come in JSON for code, or in a plain-text format designed to be easy to read and to feed into other tools. The API is rate-limited but open — no key required for normal use — so you can script literature pulls, build a custom analysis over a subset of the corpus, or integrate the Commons into a lab pipeline.

### Use with AI assistants

The Commons can connect directly to AI assistants. It runs a connector (using a standard called MCP) at **https://rmblknowledgecommons.org/api/mcp** that you can add to a client like Claude as a custom connector. Once connected, the assistant can search the Commons, pull specific records, find related work, and explore neighborhoods *on your behalf*, grounding its answers in the actual corpus rather than its general training. There's also a discovery file at the site root (**/llms.txt**) describing the Commons to AI tools. The practical payoff: you can ask an assistant to "find recent work in the Commons on X and summarize the open questions," and it will work from the real collection.

This reflects a broader design stance — researchers increasingly work *through* their own scripts and AI tools, and the Commons is built to meet you there, letting you load a relevant slice of the basin's knowledge into whatever environment you actually work in.

---

## 7. How it stays trustworthy: the community curation model

A platform like this is only as useful as it is accurate, and accuracy comes from a deliberate division of labor between automation and people.

**Automation handles scale.** The Commons continuously gathers, enriches, indexes, and connects material at a volume no person could manage by hand. This is what keeps the corpus broad and current.

**People handle judgment.** Automation gets things subtly wrong in ways a domain expert spots immediately — a misattributed author, a conflated place name, an entity extracted under three slightly different names. Human curators correct these, and the system is built so that a human correction is *durable*: once a person sets a field, the automated pipeline won't overwrite it on its next run. Human judgment and automated freshness coexist without fighting.

A few aspects of this model are worth knowing as a member of the research community, because they affect how much you can trust what you see and how you can contribute.

### Provenance and verifiability

Every record carries a memory of where it came from — whether it originated in RMBL's authoritative internal records or was found through automated discovery, and by what method. Synthesized material (neighborhood primers, frontiers) is grounded in real underlying works that you can click through to. The platform is designed to be transparent about how it knows what it claims: where a synthesis makes an assertion, you can trace it back to sources and judge for yourself.

### Reporting problems (flags)

If you spot an error — a wrong attribution, a duplicate, a miscategorized record — you can **flag** it directly from the site. Flags go into a curator's queue for triage. This is the most direct way the research community improves the Commons: the people who know the literature best are exactly the ones who notice when something is off, and the flagging system is built to turn that expert eye into a correction. If you use the Commons seriously, flagging the errors you encounter is the single most valuable thing you can do to make it better for everyone.

### Completing the record

Some material can't be reached by automated discovery — most notably paywalled publications and, increasingly, sources that aren't born as text at all (such as recorded interviews and oral histories). Curators bring these in by hand. For paywalled papers, the Commons can index a paper's full text for search while respecting copyright by **not** redistributing the file itself: you'll be able to find and search the paper's content, but the download stays with the rights holder. This is why some publications are fully searchable yet show no download button — that's working as intended.

### Why your involvement matters

The quality of the connections — the entity links, the related works, the neighborhood and frontier syntheses — depends on the quality of the underlying records. The research community is both the primary beneficiary of the Commons and its best source of correction. Using it, citing from it, flagging what's wrong, and pointing curators toward material that's missing are all ways the community directly shapes how good the platform becomes.

---

## 8. On the roadmap

The Commons is live and useful today, but several directions are underway or on the near horizon. These are framed here in terms of what they'll let you do; priorities may shift, and community feedback genuinely steers them.

**Ask in plain language, get sourced answers.** A conversational interface — ask the Commons a question in natural language and receive a synthesized answer *with citations back to the source records* — is a long-planned capability that the search and AI infrastructure has been built toward. The non-negotiable design rule is that every claim links to a real source you can verify, so it augments rather than replaces your own reading. The aim is to let you ask "what's known about drought trends in this watershed, and what are the open questions?" and get a readable, fully-sourced starting point.

**A more complete published record.** Ongoing curation is systematically filling in full text for publications that automated discovery can't reach — especially paywalled work — so that the corpus is as complete in searchable *content* as it already is in metadata. Entity extraction is also being extended more deeply across the document and dataset collections, which directly enriches the connections you rely on: denser related-works, more reliable entity pages, and better cross-collection links between papers, the data behind them, and the policy context around them.

**New kinds of sources.** Material that isn't born as text — recorded interviews and oral histories in particular — is a near-term addition. Once transcribed, it flows through the same search and connection machinery as everything else, which means a layer of the basin's institutional memory that has never been searchable will become discoverable alongside the written record (handled with appropriate care for consent and rights).

**Richer frontiers and synthesis.** The frontiers layer will continue to deepen as a tool for scoping new work and supporting research-program and funding conversations — organizing open questions by theme, effort, and the kind of action they'd require, always traceable down to the underlying literature.

**Deeper integration with your tools.** Expect continued investment in the programmatic API and AI-assistant connectivity, so that pulling a relevant slice of the Commons into your own analyses, pipelines, and chat sessions keeps getting easier.

**The approach, shared.** Much of what powers the Commons isn't specific to the Gunnison Basin. There's longer-term interest in making it reusable so peer field stations and research institutions could stand up their own versions — a sign that the *way* the Commons connects knowledge may prove useful well beyond RMBL.

If any of these would be especially valuable for your work — or if there's something missing that would be — that input is worth sharing; the roadmap is responsive to what the research community actually needs.

## 9. Principles, and an invitation

A few ideas run through everything above and explain why the Commons works the way it does.

**Connection over collection.** The value isn't the size of the pile; it's how well it's connected. That's why so much of the platform is about relationships — entities, related works, graphs, neighborhoods, frontiers.

**Meet researchers where they work.** Citation export, an open API, and AI-assistant connectivity exist so the Commons feeds your workflow rather than replacing it.

**Verifiability.** Provenance is always recorded, and synthesized claims trace back to real sources. The platform would rather be transparent about uncertainty than confidently wrong.

**Two audiences, equal weight.** The specialist tools never come at the expense of public legibility, and vice versa.

The Knowledge Commons is live, useful, and still growing. The most powerful thing about it for the research community isn't any single feature — it's that the basin's knowledge is now connected enough to support questions that span the literature, and open enough to flow into your own work. Explore it at **https://rmblknowledgecommons.org**, pull from it through the API or your AI tools, and help keep it accurate by flagging what you find. It improves fastest when the people who know the work best are the ones shaping it.
