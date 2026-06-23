# The RMBL Knowledge Commons: A Deep Dive

*How it was built, how it is curated, and where it is going*

*Last updated: June 2026*

---

## 1. What the Knowledge Commons is, and the problem it solves

The Rocky Mountain Biological Laboratory has been generating knowledge about the Gunnison Basin for nearly a century. That knowledge lives in a lot of different places: peer-reviewed papers scattered across hundreds of journals, student theses, datasets deposited in a dozen different repositories, community and policy documents produced by local organizations, and decades of news coverage about the region. Each of these is valuable on its own. The trouble is that they have never been *connected*. A researcher studying alpine wildflower phenology might never discover that a county planning document cites the same field site, or that a local newspaper covered the very long-term study they are building on, or that a dataset published in an obscure repository contains exactly the measurements they need.

The Knowledge Commons exists to dissolve those boundaries. It is a single, searchable platform that pulls all of this material into one place and — crucially — discovers the relationships *between* the pieces. It is not just a library catalog or a search box. It is a map of how the basin's knowledge fits together: which researchers work with which others, which species show up alongside which research methods, which scientific concepts cluster into recognizable research communities, and where the open questions and frontiers lie.

At the time of writing, the Commons holds roughly:

- **4,852 publications** — peer-reviewed articles, theses, and student papers
- **1,769 documents** — community and policy material from the Sustainable Living Library, plus 388 Federal Register notices (1995–2025)
- **1,426 datasets** — research data from eight discovery sources
- **841 stories** — news articles from regional outlets
- **7,512 authors** — a deduplicated, cross-collection registry of people
- **118 projects**, **4,334 species**, **8,225 places**, **1,474 protocols**, **3,607 concepts**, and **5,823 stakeholders** — the "entities" that thread through everything
- **146 research neighborhoods** and **166 frontiers** (68 paper-grounded with verbatim cites + currency tracking, 98 legacy) — higher-order structures synthesized from the rest
- **151,746 references** and **151,728 entity mentions** — the connective tissue of the whole thing

Those numbers grow every time the system runs, and a large part of the curation role described later in this document is about helping them grow in the *right* way — adding the sources that automated discovery cannot reach, and correcting the things that machines get subtly wrong.

The guiding philosophy is worth stating up front, because it shapes every design decision that follows: the Commons serves two audiences with equal weight. One is the professional research community — scientists, graduate students, agency staff. The other is the public — local residents, land managers, journalists, curious people. The system is deliberately built so that a hydrologist and a county commissioner can both find what they need without one of them being treated as a second-class user. That dual mandate is why the interface avoids jargon where it can, why citations are always exportable, and why the same piece of underlying data is presented in several different ways depending on who is asking.

---

## 2. The shape of the collection

Before getting into how the system was built, it helps to understand how the material is organized, because the organization *is* a lot of the value.

Everything in the Commons falls into one of two broad categories: **content** and **entities**.

**Content** is the stuff you would recognize as a "thing you can read or download" — a publication, a document, a dataset, a news story. Each lives in its own collection with metadata appropriate to its type. Publications carry authors, abstracts, DOIs, and citation data. Datasets carry creators, repositories, licenses, and the methods used to produce them. Documents carry the organizations that authored them and the policy topics they address. Stories carry their source, date, and classification.

**Entities** are the concepts that recur across all that content. A *species* like the yellow-bellied marmot is an entity. A *place* like Gothic, Colorado is an entity. A *protocol* — a standardized research method, like a particular way of measuring snowpack — is an entity. A *concept* (an abstract scientific idea) and a *stakeholder* (an agency or organization) are entities too. Entities are not documents you read; they are the vocabulary the documents share.

The reason this distinction matters is that the relationships between content and entities are where the Commons becomes more than the sum of its parts. When a publication, a dataset, and a news story all mention the same place and the same species, the system records those connections as **entity mentions**. Multiply that across nearly a hundred thousand mentions and you get a dense web — a knowledge graph — that can answer questions no individual document could. "What methods are commonly used to study this species?" "Which researchers have worked at this site across the last forty years?" "Which datasets underpin this body of published work?" None of those questions can be answered by reading one paper. They can be answered by the structure connecting many.

A useful way to picture it: the content collections are the *nouns and stories* of the basin's knowledge, and the entities are the *shared language* that runs through them. The platform's job is to read everything, learn that shared language, and then show you the connections.

---

## 3. How it was built

The Commons was assembled in layers, each building on the one before. What follows is the rough order in which those layers came together, and what each one does. Think of it as a pipeline: raw material comes in one end, and a richly connected, searchable knowledge base comes out the other. The pipeline runs in ten distinct phases, and understanding them in plain terms is the best way to understand the whole system.

### 3.1 Gathering the sources

The first job is simply getting the material in. This happens two ways.

The first is **scraping** known sources — going to a website that we know contains relevant material and systematically reading it. The Commons scrapes RMBL's own publications database, the Sustainable Living Library, RMBL's data catalog, and several regional news outlets. Scraping sounds crude, but doing it well is surprisingly delicate: websites change their layouts, rate-limit visitors, and bury the real content inside layers of navigation. Each source has its own dedicated scraper that knows how to read it.

The second is **discovery** — actively going out to find material that *isn't* in any single known list. This is where the system queries large scholarly databases (services like OpenAlex, CrossRef, DataCite, and Semantic Scholar) and asks, in effect, "what else has been published about this region, by these people, that we don't already have?" Discovery is how the Commons grew beyond RMBL's internal records: of the publications in the system, a substantial fraction were found this way rather than handed over in a list. Discovery is powerful but noisy — it surfaces a lot of candidates that *look* relevant but aren't (the word "Gunnison" appears in publications about an entirely different John W. Gunnison, for instance), so a great deal of careful filtering sits behind it.

### 3.2 Enrichment

Raw records arrive incomplete. A scraped publication might have a title and an author list but no abstract, no DOI, no information about which other works it cites. **Enrichment** is the process of filling those gaps by cross-referencing external services. The system looks up DOIs, fetches missing abstracts, retrieves author identifiers (ORCIDs, which are like permanent ID numbers for researchers), and pulls citation metadata. For datasets, it fetches structured metadata from the repositories that host them. The result is that a thin, partial record becomes a full one — which matters enormously for both search quality and the connection-finding that comes later.

### 3.3 Making it searchable

Once the material is in and enriched, it has to become *findable*. The Commons uses two complementary kinds of search, and the combination is deliberate.

The first is **keyword search** — the familiar kind, where you type words and the system finds documents containing those words. Under the hood this uses a PostgreSQL feature called a *tsvector*, which is essentially a pre-computed, weighted index of every meaningful word in every document, with titles weighted more heavily than abstracts and abstracts more heavily than full text. This is fast and precise when you know the exact terminology.

The second is **semantic search**, and this is where a bit of modern machine learning comes in. Every document is run through a service that converts its meaning into a long list of numbers called an **embedding** (specifically, a 1,024-number vector from a model called Voyage AI's voyage-4). The useful property of embeddings is that documents about similar things end up with similar numbers, *even if they use completely different words*. A search for "flower blooming times" can surface a paper titled "phenological shifts in subalpine forbs" because their embeddings sit near each other in this numerical space, despite sharing almost no vocabulary. Embeddings are what let the system understand that two things are *about* the same topic rather than merely sharing the same words.

The Commons blends these two approaches — keyword for precision, semantic for recall — into a single **hybrid search**. This is why a search can be both literal and conceptual at once.

### 3.4 Extracting meaning

This is the most distinctive layer, and the one that turns a searchable archive into a genuine knowledge graph.

A large language model — the same family of AI that powers conversational assistants — reads each document and extracts the entities it contains: the species, places, protocols, concepts, and organizations mentioned. For publications, this even uses *vision*: rather than just reading extracted text, the model looks at the actual pages of the PDF, including figures, tables, and captions, because a great deal of a scientific paper's substance lives in places that plain text extraction misses. This full-corpus extraction was a significant undertaking — running the model across roughly 1,600 publications cost on the order of a few hundred dollars in compute — and it is what populated the entity collections.

Extraction alone isn't enough, though, because the model is messy in predictable ways. It might extract "yellow-bellied marmot," "yellow bellied marmots," and "Marmota flaviventris" as three separate species when they are one. So extracted entities go through **validation and clustering**. Species names are checked against ITIS, an authoritative taxonomic database, to confirm they are real and to merge variants. Places are matched against GNIS, the federal geographic names database, so they get real coordinates and a place in a geographic hierarchy. Protocols and concepts are clustered using embeddings — the same numerical-meaning trick from search — so that near-duplicate phrasings collapse into single, canonical entities. Stakeholders get the same treatment: thousands of raw mentions of agencies and organizations (with all their abbreviations, misspellings, and partial names) are clustered down into a clean roster of distinct institutions. The result across the board is a deduplicated vocabulary rather than a sprawling mess of slight variations — and that clean vocabulary is what makes every downstream connection reliable.

It is worth dwelling for a moment on why the *vision* step matters so much, because it's easy to underrate. A scientific paper is not just prose. Its most concentrated information often lives in a figure showing a study site, a table of measured variables, or a caption naming a species and a method in the same breath. Plain text extraction — the kind that just pulls the words out of a PDF — routinely garbles or skips these. Having the model actually look at the rendered page recovers a layer of meaning that would otherwise be lost, which is why the publication extraction was done this more expensive way rather than the cheap text-only way.

### 3.5 Building the graph, the neighborhoods, and the frontiers

With clean entities and a record of every place they're mentioned, the system can build the **knowledge graph**: a network where the nodes are documents, people, and entities, and the edges are the relationships between them (co-authorship, citation, shared topics, co-occurrence). This graph has thousands of nodes and tens of thousands of edges.

A graph that big is hard for a human to look at directly, so the system does two clever things with it.

First, it runs **community detection** — an algorithm (called Louvain) that finds clusters of nodes that are more tightly connected to each other than to the rest of the network. These clusters turn out to correspond to recognizable research communities: a group of researchers, species, places, and concepts that genuinely belong together as a line of inquiry. The Commons identifies about 151 of these **neighborhoods**, and then has a language model write a readable **primer** for each one — a short synthesis describing what that research community studies, who its key contributors are, and what its open questions seem to be.

Second, it takes the open-question statements from across all those neighborhood primers and synthesizes them into **frontiers** — higher-level descriptions of where the basin's knowledge has boundaries and where future work might go. Frontiers come with key questions, concrete suggested actions, and identified data gaps. They are deliberately pitched at the level a research director or a funding body might find useful: not "this one paper left a question open" but "across dozens of research communities, here is a recurring frontier."

### 3.6 The technology underneath

A brief word on the machinery, in plain terms, because it explains some of the curation workflow later.

The whole thing is a single web application built with **Next.js** (a popular framework for building fast, modern websites) with a content-management system called **Payload** embedded inside it. Payload is what provides the **admin panel** — the behind-the-scenes interface where a curator logs in to edit records. The data lives in a **PostgreSQL** database (with the pgvector extension that stores those embedding vectors). In production, the database is hosted on a managed service called Neon, and the website itself runs on Vercel. The AI work — extraction, primers, frontiers — uses Anthropic's Claude models, and the embeddings use Voyage AI.

One design decision is worth flagging because it directly affects curation: there is a **public side** and an **editing side** of the same system. The public side is the website anyone can visit. The editing side is the Payload admin panel, which requires a login. Everything a curator does happens in that admin panel, and the platform is built to keep human edits and automated updates from stepping on each other — which is the subject of the next section.

### 3.7 Following one record through the pipeline

To make all of this concrete, it helps to trace a single publication from the outside world into its finished place in the Commons.

Suppose a paper on subalpine wildflower phenology is published in a journal. Automated **discovery** finds it first: while querying a scholarly database for work related to the basin, the system encounters this paper's record and recognizes it as plausibly relevant. At this stage the record is thin — a title, an author list, a journal name, maybe a DOI. It is also, importantly, *unverified*: discovery casts a wide net and pulls in some false positives, so the record carries provenance noting that it was found by discovery rather than supplied by RMBL's authoritative list.

Next, **enrichment** fleshes it out. The system looks up the DOI, retrieves the full abstract, matches the authors to their permanent ORCID identifiers (and to existing author records already in the Commons, so the same researcher isn't created twice), and pulls the list of works the paper cites. The skeletal record is now a complete one.

Then the record is **loaded** into the database, where a background process immediately computes its keyword index and a language model later computes its semantic embedding — so the paper becomes findable by both exact terms and conceptual similarity. If the paper's full text is available, the **extraction** step reads it (looking at the actual pages where possible) and pulls out the species it studies, the field sites it names, the methods it uses, and the concepts it engages. Each of those becomes an **entity mention**, wiring the paper into the knowledge graph.

Finally, the paper takes its place in the larger structures: it becomes a node in the graph, it may fall inside one of the research **neighborhoods** when communities are next detected, and its open questions may eventually feed the **frontiers** synthesis. A reader can now find it by keyword or concept, see which other works it connects to, follow its authors to their other publications, and export a clean citation.

The one thing automation may *not* have managed is acquiring the full text, if the paper sits behind a paywall. That gap is exactly where a curator steps in — which brings us to the curation model.

---

## 4. The curation model

Automation gets the Commons most of the way. It does not get it all the way, and it never will. Discovery cannot reach paywalled publications or material that exists only as audio. Extraction makes mistakes a domain expert would never make. Deduplication is good but not perfect. The whole point of having a human curator is to handle exactly the things that automation cannot, and to do so in a way that the automation then *respects* rather than overwrites.

This is the central tension the curation model is built to resolve. The pipeline runs repeatedly — re-scraping, re-discovering, re-enriching. If a curator carefully corrects an author's name today and the pipeline runs tomorrow, the correction must survive. The system solves this with a mechanism called **cell-level curation**, and understanding it is the key to curating confidently.

### 4.1 Cell-level curation: how human edits are protected

Every record that a curator can edit has a hidden field that records *which specific cells a human has touched*. When you edit a publication's title in the admin panel, the system quietly notes "the title of this record was set by a person." From then on, the automated pipeline is forbidden from overwriting that title. It can still update *other* fields on the same record — the abstract, the citation count — but the title is now yours. It has been "claimed" by human judgment.

This is more precise than a blunt "locked / unlocked" switch on the whole record. You can correct one field and leave the rest under automated management. The mental model is: **the pipeline owns a field until a human asserts otherwise, cell by cell.** When a curator edits a cell, that cell flips to human ownership. The pipeline keeps everything else fresh while leaving human judgment untouched.

There is a deliberate escape hatch. If you clear a field you previously edited — emptying it out — the system interprets that as "I no longer want to own this; give it back to the pipeline." There is also a small widget in the admin sidebar that lists every cell you've claimed on the current record, each with a release button, so you can hand a field back to automation explicitly. This matters because sometimes a curator fixes a value as a stopgap, and later the automated source catches up and becomes more reliable; releasing the cell lets the better data flow back in.

The practical upshot for day-to-day curation: **edit fearlessly.** Your corrections are durable. You are not in a race against the next pipeline run. And if you ever want a field to go back to being automatically maintained, there's a clear way to do that.

### 4.2 Provenance: knowing where everything came from

Closely related is **provenance** — the system's memory of where each record originated. Every publication, for instance, is tagged with whether it came from RMBL's own database or was found through automated discovery, and by what method. This is not bookkeeping for its own sake. It lets the platform (and the curator) treat sources differently: a record from RMBL's authoritative internal list is trusted differently from one a discovery algorithm proposed. When you are evaluating whether something belongs in the Commons, provenance tells you how it got there and how much scrutiny it has already had.

### 4.3 Flags: reporting problems

Not every problem is something a curator spots while editing. Sometimes a member of the public notices that a record is wrong, or duplicated, or miscategorized. The Commons has a **flags** system for this. Anyone can submit a flag against a piece of content — anonymously, with some safeguards against abuse — and those flags show up in the admin panel, both in a dedicated queue and as a small widget on the edit page of whatever was flagged. A curator can then triage: resolve it, reject it, or act on it. Flags are the structured way that "something's off here" gets from a reader's eye into a curator's worklist.

### 4.4 Adding sources the machine can't reach: paywalled publications

Here is where a curator does work that no amount of automation can replace.

A large share of relevant scholarship sits behind paywalls — journals from major publishers, institutional repositories, and platforms that actively block automated access. Testing showed that only a small fraction of automatically-found PDF links actually return a usable file; the rest are session-gated or protected against bots. These papers are real, relevant, and important, and the only reliable way to bring their *content* into the Commons is for a person to acquire them legitimately and add them by hand.

The system has a purpose-built workflow for this, designed around an important constraint: **the Commons can index the full text of a restricted paper for search without redistributing the file itself.** This respects copyright — the platform is not republishing paywalled PDFs — while still making the paper's content discoverable.

The workflow has a clear shape:

1. The system generates a **worklist** — a spreadsheet of publications that are missing their full text, prioritized by how useful they'd be (recent, frequently relevant, and so on). This is produced by an export step (`worklist:export`).
2. A curator works through the list, legitimately acquiring each PDF (through library access, direct request to authors, institutional subscriptions), and dropping the files into a designated staging folder, noting where each came from.
3. An ingest step (`pdf:ingest-manual`) processes the staged files: it extracts the text, attaches that text to the right record for search indexing, marks the record as having a *restricted* PDF, and files the original away in a processed archive.
4. Because the record is marked restricted, the public website indexes and searches its text but **hides the download button**. A visitor can find the paper, read its abstract, see its references and related works, and get search hits from inside its full text — but cannot download the file from the Commons. The blob stays local; only the searchable text and metadata are published.

This is exactly the kind of high-judgment, can't-be-automated work that makes the Commons more complete and more trustworthy. A curator who systematically works through the worklist is directly expanding what the basin's knowledge base can answer.

### 4.5 Adding new *kinds* of sources: toward audio and beyond

Everything described so far assumes the material is, fundamentally, text — or can be turned into text. The most interesting near-term expansion of the curation model is bringing in sources that *aren't* born as text at all, the clearest example being **recorded interviews and oral histories**.

The basin's knowledge is not only written down. A great deal of it lives in the memories and voices of long-time researchers, residents, and land managers. Capturing that as part of the Commons means treating an audio recording as a first-class source. Conceptually, the path mirrors what already exists for text: an interview is transcribed (turning speech into text), and from that point forward it can flow through the same machinery as everything else — its text is indexed for search, entities are extracted from it (the species, places, people, and concepts the speaker mentions), and it gets connected into the knowledge graph alongside the written record.

The curation considerations for this kind of material are distinctive, and they are squarely human judgment calls: confirming that the transcription is accurate (automated transcription is good but errs on proper nouns and technical terms — exactly the things that matter most here), handling consent and any restrictions on how a recording may be used or displayed, and deciding what is published versus held for search only. The Commons already has a precedent for the "indexed but not displayed" pattern in how it handles news stories, whose full text is stored to power search but not shown publicly for copyright reasons. Audio interviews will likely use a similar rights-aware approach, calibrated to whatever the speaker agreed to.

The takeaway is that the curation model is designed to *extend* to new source types rather than being locked to the ones it started with. Adding a new kind of source is partly an engineering task (building the transcription and ingest path) and partly a curation task (verifying quality, managing rights, making the connections trustworthy). Both halves matter.

### 4.6 Removing duplicates: tombstones

Because the Commons pulls from many overlapping sources, the same publication sometimes arrives twice under slightly different metadata. A curator who spots a genuine duplicate can delete it — but here the recurring pipeline creates a subtle hazard. If you simply delete a duplicate, the next discovery run will find the original source again and faithfully recreate the very record you removed.

The system prevents this with **tombstones**. When a curator deletes a duplicate, the platform records the deleted record's identifying fingerprints (its DOI, its title, its year) in a small registry. From then on, the loaders that bring in new records check incoming candidates against that registry and skip anything that matches. The deletion sticks. The deleted item's old web address simply returns "not found" rather than springing back to life on the next run.

A couple of things are worth knowing about this design, because they reflect deliberate trade-offs. Deletion is a clean removal, not a merge — there's no automated "combine these two records and keep the best of each." And there's no built-in undo; reversing a mistaken deletion means restoring from a database backup. The design favors simplicity and predictability over cleverness, on the theory that a curator deleting a duplicate wants it *gone and stayed gone*. The implication for curation practice: be deliberate about deletions, and lean on the flags system to surface candidate duplicates before acting.

### 4.7 What a curation session looks like in practice

It can help to imagine the rhythm of the work rather than just its components. A curator logs into the admin panel and is met with the collections down one side and, depending on the day, a queue of flags that the public or fellow curators have raised. A typical session might move through several modes.

There's *triage*: working the flag queue, deciding which reports are real, fixing what's fixable, and clearing the rest. There's *correction*: opening records that extraction or enrichment handled imperfectly — an author whose name got split into two people, a place that was mis-identified, a date that came through wrong — and fixing them, confident that the cell-level mechanism will protect each fix. There's *completion*: pulling up the PDF worklist and methodically acquiring full text for high-value paywalled papers, then running the ingest so their content becomes searchable. And there's *connection-checking*: spot-reviewing the entities on important records to make sure the species, places, and methods were correctly identified and linked, because those links are what give the knowledge graph its value.

A good curator develops a feel for where the automation tends to stumble — certain publishers whose metadata is messy, certain place names that get confused, certain kinds of documents where extraction is thin — and focuses attention there rather than spreading it evenly. Over time, the curator's corrections also become a kind of feedback: patterns in what needs fixing point to where the pipeline's prompts or filters could be improved, which is information worth surfacing to whoever maintains the system. The work is iterative and never quite "done," but it compounds: every correction, every acquired paper, every verified connection makes the next person's search a little more trustworthy.

### 4.8 The shape of the curation role, in summary

Pulling the threads together, a curator's work spans a spectrum:

- **Correcting** — fixing the things extraction and enrichment got wrong, protected by cell-level curation so corrections endure.
- **Completing** — bringing in the material automation can't reach, especially paywalled publications via the manual worklist, and increasingly new source types like recorded interviews.
- **Adjudicating** — triaging flags, removing duplicates, and making the rights-and-consent judgment calls that no algorithm should make on its own.
- **Connecting** — confirming that entities are correctly identified and linked, because the quality of the knowledge graph depends on the quality of those connections.

None of this is data entry. All of it is judgment applied at the points where automation runs out — which is precisely why it's valuable.

---

## 5. Where the Knowledge Commons is going

The Commons is built, live, and useful today, but it is far from finished. Several directions are either underway or clearly on the horizon.

### 5.1 Deepening the corpus

The most immediate frontier is simply *completeness*. The automated layers have done the broad sweep; the next gains come from depth. That means systematically working through the paywalled-publication worklist so that the basin's published record is as complete in *content* (searchable full text) as it is in *metadata*. It also means continuing to extend entity extraction across the document and dataset collections so that those materials are as richly connected as the publications already are. Every paper whose full text gets added, and every document whose entities get extracted, makes the knowledge graph denser and the search smarter.

### 5.2 New source types: audio and oral history

As described above, bringing recorded interviews and oral histories into the Commons is a near-term expansion that genuinely widens what the platform represents. It captures a layer of the basin's knowledge that has never been part of a searchable archive, and it stress-tests the curation model against a fundamentally new kind of material. Success here is as much about getting the human process right — transcription verification, consent, rights — as it is about the technical plumbing.

### 5.3 "Ask the Knowledge Commons": conversational answers with citations

A longstanding part of the vision, and one that the search and AI-access infrastructure has been quietly preparing for, is a conversational interface — the ability to ask the Commons a question in plain language and get a synthesized answer *with citations back to the source documents*. This is the technique often called retrieval-augmented generation: the system retrieves the most relevant material from the Commons, hands it to a language model, and the model composes an answer grounded in (and linked to) that real material rather than its own training. The non-negotiable principle is that every claim traces back to a source you can click through to and verify. This is what would let a county commissioner ask "what's known about drought trends in this watershed?" and get a readable, sourced answer — exactly the dual-audience promise the Commons was founded on.

### 5.4 Frontiers and strategic synthesis

The frontiers layer — the synthesized map of where the basin's knowledge has boundaries — is increasingly aimed at a planning and leadership audience. By aggregating open questions across research communities and organizing them by theme, effort, and the kinds of action they'd require, the Commons can support conversations about *where research effort should go next*, not just *what has been done*. This is a distinctive capability: most knowledge bases tell you what's known, while this one also tries to articulate, in a grounded way, what isn't.

### 5.5 Making the Commons usable by AI assistants and other tools

A quietly important direction is interoperability. The Commons isn't only meant to be visited by humans through a web browser; it's built to be *consumed by software and AI assistants* as well. It exposes a structured public interface (a versioned API) that returns clean, machine-readable results, and it supports a standard called MCP that lets AI assistants like Claude connect to the Commons directly and search it on a user's behalf. There's even a small file at the root of the site specifically describing the Commons to AI crawlers. The thinking here is that researchers increasingly work *through* AI tools and their own scripts, and the Commons should meet them there — letting someone pull a relevant slice of the basin's knowledge directly into whatever they're working in.

### 5.6 A template for other institutions

Finally, there is interest in the longer term in making the Commons reusable. RMBL is one field station among many, and much of what's been built — the pipeline, the search, the knowledge-graph construction, the curation model — is not specific to the Gunnison Basin. Roughly two-thirds of the system is genuinely generic; the remaining third is the regional and institutional flavor (the specific sources, the place-name expertise, the topic vocabulary, the institutional voice). Reshaping the Commons so that a peer institution could stand up its own version is a plausible future, most valuable if it starts small — externalizing the institution-specific settings into one place — rather than trying to abstract everything at once. This is not committed work, but it reflects a belief that the *approach* the Commons embodies is worth sharing.

---

## 6. Principles that hold it all together

It's worth closing on the ideas that recur throughout, because they explain why the system behaves the way it does and what a curator is ultimately serving.

**Connection over collection.** The Commons is not trying to be the biggest pile of documents. It is trying to be the most *connected* one. The value is in the relationships, which is why so much effort goes into entities, the graph, neighborhoods, and frontiers.

**Two audiences, equal weight.** Every design choice asks whether it serves both the specialist and the public. Neither is an afterthought.

**Automation for scale, humans for trust.** The pipeline does the work no human could do at this scale. Humans do the work no pipeline could do well. The cell-level curation model exists precisely so these two can coexist without conflict — automation never overwrites human judgment, and human judgment never has to fight the next automated run.

**Provenance and verifiability.** Where something came from is always recorded, and any synthesized claim must trace back to a real source. The Commons would rather be transparent about uncertainty than confidently wrong.

**Respect for rights.** The system is careful about what it redistributes. It will index the full text of a restricted publication to make it findable, but it won't hand out the file. It stores news text for search but doesn't republish it. New source types like audio will be handled with the same care for consent and copyright.

These principles are not abstract. They show up in the database schema, in the curation tools, in the way search works, and in the daily judgment calls of whoever is tending the collection. The machinery is impressive, but the machinery is in service of something simple: making a century of knowledge about one remarkable place genuinely usable — by anyone who needs it, for whatever they need it for.
