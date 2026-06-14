*Story grounded in [Centennial Cross-Mountain](../../scenarios/centennial-2027/centennial-cross-mountain.md). Mode: Stress-overlay. Year: 2039. Word count: 1549. Published: internal-only.*

---
# The Harmonization Problem

The Andrews lead wanted coffee before they went back in. Maya did too, though what she wanted was twenty minutes in a room with no people in it, and that was not on offer today.

"We can live with five bands," he was saying, in the hallway outside the meeting room, gesturing with an empty mug. "What we can't live with is recategorizing the 1985–2010 data. There's no one left who took those measurements."

"Nobody's asking you to recategorize," Maya said. "We're asking the crosswalk to do it, and to flag the uncertainty."

"The crosswalk has opinions."

"The crosswalk has *priors*. There's a difference."

He laughed. The Niwot lead came out behind them and went straight for the carafe without speaking, which Maya took as a good sign — Eli only got quiet when he was thinking, and he'd been loud all morning. Through the window above the coffee table she could see Whetstone, its south face bare to the rock in patches that would have been unthinkable in February when she'd arrived in 2028. The snowpack down here in town was thin enough this winter that the willows along Coal Creek had stayed visible all season.

She topped off her own mug. The room smelled the way these rooms always smelled: old coffee, dry-erase markers, the faint chemical tang of the new carpet RMBL365 had put in two years ago, after the renovation that had carved this whole floor into working rooms with movable walls. The walls were currently arranged for eight stations plus the synthesis team plus the two postdocs from UNAM who'd flown up Sunday. There were too many people. There had been too many people every day since the meeting started.

"Maya." The Sierra Nevada lead was in the doorway. "Fifteen minutes? Before lunch. The aquatic stuff doesn't quite fit your phenology schema and I want to walk you through where."

"After lunch," she said. "Iris has me at 11:30."

"After lunch."

She wrote it on her tablet. The afternoon was now full. The afternoon had been full at 9:14 this morning, and it had refilled twice since.

---

In the meeting room Iris from the high-elevation Mexican station — Nevado de Toluca, four thousand meters, no real winter snowpack to speak of — was at the whiteboard with two of the Canadians, sketching something. Maya came in and stood at the back. The sketch was a kind of decision tree, branching on whether the dominant phenological cue at a given site was snowmelt or photoperiod or soil-moisture release after a dry season.

"This is the problem," Iris said, when she saw Maya. "Your protocol assumes snowmelt. Mine has no snowmelt. The protocol still has fields for snowmelt date, and we leave them null, but null isn't no-snow, null is no-data, and the crosswalk treats them the same."

"It shouldn't."

"It does."

"I know. We — " She caught herself. *We* meant the basin data team. "We knew about this in 2034. We thought we'd solved it with the latitude band. We didn't."

"You solved it for Andrews. You didn't solve it for me."

Maya sat down at the table, set her coffee down, and pulled the federation console up on her tablet. It was the version they'd shipped in November — the one with the cross-station query layer the synthesis postdocs were already using to push real comparisons through, sometimes faster than the senior scientists wanted them pushed.

"Show me a record where it matters."

Iris leaned over. "*Lupinus montanus*, west slope, 2032 through 2038. First-flower. The crosswalk says it shifted earlier by nine days, and it didn't, it shifted later by four because the rains came late three of those years."

Maya opened the record. The federated query ran across her own console and the Nevado plot archive in Toluca — twenty seconds, which still felt fast to her even after seven years of building toward exactly this. The crosswalk's flag was sitting right there in the metadata: *snowmelt-cued / null source / interpolated*. The interpolation had been wrong in a way that was, she could see now, structural rather than accidental.

"Okay," she said. "That's an ontology bug, not a data bug. We can fix it. I want to do it with you in the room because I want to do it right this time."

"I have a flight Friday morning."

"Tomorrow afternoon. After the plenary."

Iris nodded. The Canadians had stopped sketching and were watching. One of them — Maya had forgotten her name, which she found mortifying but it was day three and there were thirty-two people and she had slept badly — said, "We have something similar with the photoperiod sites. Could we sit in?"

"Yes," Maya said. "Yes. Bring your data."

---

At lunch she didn't eat with the scientists. She walked four blocks down Elk Avenue to the place her wife liked and got a sandwich to go, and stood outside in the thin February sun reading messages. Her son's school had called. He'd been sent home with what the nurse thought was strep, and Daniel was working from home anyway so it wasn't a crisis, but Maya read the message twice and felt her shoulders drop in the particular way they only did when someone she loved was sick. *Tell him I'll come read to him after the dinner thing,* she wrote back. *Late. Don't wait up.*

A truck went by — one of the new electric ones the county had been buying since the inversions got bad — almost silent on the cleared pavement. The light off Mount Crested Butte was sharp and southern. She thought about the meadow plots above Gothic, six miles up the closed road, buried under what snow there was. The glacier lilies that would push up there in late June, three weeks earlier than they had in her first summer in the basin. The marmots — somewhere up there, asleep, in their hundredth recorded year, though Maya had not actually seen a marmot since August.

She ate half the sandwich on the walk back.

---

The afternoon session was the synthesis postdocs presenting the draft figures. The figures were good. They were also, Maya could see, going to need to be redone, because the Toluca correction was going to ripple. The lupine result was the cleanest comparative phenology signal in the draft, and it was wrong in exactly the way Iris had just shown her, and probably wrong in three other ways nobody had found yet.

She caught the lead postdoc's eye across the table and made a small gesture — *come find me, not now, later.* He nodded.

Eli leaned over. "How bad."

"Not bad. It's a fix. But the figure changes."

"Decadal pattern still holds?"

"I think so. Magnitude's different."

He grunted. "That's going to be a long Friday."

"Friday's going to be long regardless."

He didn't disagree. He'd been one of the people, back in 2029, who'd argued hardest against the federated architecture — wanted RMBL to just host everything, faster, simpler, control the schema, ship the platform. Maya had been on the other side of that argument. She had won, in the sense that the federated build was what got built; she had also spent every working day since then maintaining a reference implementation that other stations could fork, which was harder than hosting would have been, by a factor she sometimes calculated when she was tired. The thing it bought them was sitting across the table from her right now in the form of Iris, who would not be in this room at all if her station's data had to live on a server in Gothic.

The argument had been worth winning. Most days she remembered that.

---

At 4:30 she finally got the twenty minutes. She closed her office door and sat with her tablet and pulled up the working notes from Iris's session and started drafting the ontology revision. The federation had a process for this — every station director had to sign off, which took weeks, which was the price of distributed governance. She wrote the proposal carefully. *Null in a snowmelt-date field should not be interpreted as "snowmelt absent." A separate flag should distinguish.* She had written something like this in 2034 and not pushed it through because the workaround had seemed good enough. It had not been good enough. She wrote the sentence she would keep arguing with for the next week:

*The crosswalk has been treating absence of snow as absence of information, and this is wrong in ways that get worse as the network reaches lower latitudes.*

She read it back. It would do as a starting point. She sent it to Iris and to the two Canadians and to Eli, with a note: *tomorrow, after plenary, room 4, bring records.*

Through the window the light was already going. There was an event in the lobby downstairs at six that she was supposed to be at. Daniel had texted a photo of their son asleep on the couch with the cat. She put her tablet down, picked it up again, and forwarded Iris's lupine plot to the synthesis postdoc with three words: *we have to talk.*

Then she went downstairs to find more coffee.
