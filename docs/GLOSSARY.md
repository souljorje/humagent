# Glossary

This glossary is the source of truth for names in Humagent.
Use each term with this meaning in code, documents, the interface, and messages. Do not add a second name for a listed thing.
Change the glossary first when a name changes.

| Term | Meaning |
| --- | --- |
| human | The person who gives feedback on a page. Agent instructions call this person the user. |
| agent | The AI coding agent that receives the feedback and changes the source. |
| source | The HTML file or localhost app that the human gives feedback on. |
| page | The source as the browser shows it. |
| workspace | The browser tab that shows the page and the bar. |
| bar | The floating control in the workspace. Closed, it is one button. Open, it shows the instruction, Send, and the pending reviews. |
| session | One source with its saved reviews, instruction, and feedback. |
| feedback | Everything that one Send delivers to the agent: the instruction and the reviews that were pending. |
| review | One piece of feedback, such as a comment, a text edit, or form values. |
| summary | The title and optional details a plugin shows for a pending review. |
| comment | The human's text on one review. A review of kind `comment` has only this text. |
| draft | The review that the current page input proposes before the human saves it. |
| kind | The type of a review. One plugin defines each kind. |
| target | The page element that a review refers to. |
| pending | Not sent. A review is pending until the human chooses Send. |
| instruction | The human's text for the whole feedback. |
| receipt | The agent's hold on delivered feedback. The agent completes the receipt after it applies the feedback. |
| annotating | The mode in which the human selects a target for a review with the pointer or keyboard. The open bar turns it on. |
| marker | The numbered pin of a pending review on the page. |
| preview | A text edit that the page shows in place before the agent applies it. |
| revision | The version of the page's HTML. A review belongs to one revision. A stale review belongs to an older one. |
| plugin | The data rules and summary for one review kind. |
| page input | A page interaction or script call that produces a review. |
| picker | A page input that can claim or block a selection during annotating. |
| session key | The credential of one session. The workspace holds it. The page never sees it. |
| control token | The credential of the agent's commands. |
