// Authored offline contract fixtures, NOT assertions about these manufacturers
// and never available to the production pipeline as fallback content.
export const fixtureDay = "2026-10-11";
export const fixtureUrls = ["https://www.tatamotors.com/technical-reference", "https://www.cummins.com/component-reference"];
const quote1 = "Keep the vehicle identification and component reference together when requesting replacement parts.";
const quote2 = "Record the complete identification from the component label before preparing an enquiry.";
export const fixturePages = [
  `${quote1} This training reference describes the information fields used in a workshop request.
  The reference sheet separates the vehicle identifier, assembly description, component marking,
  document revision and observations. An illustration may help locate an identification plate,
  but an illustration is not a specification for every vehicle. The record includes space for
  the maintenance operation, inspection notes and the person responsible for checking documentation.
  When information is missing, record it as unknown rather than selecting a similar-looking item.
  The workshop should use the documentation applicable to the vehicle being discussed.
  This sample reference does not establish stock, authorization, price, warranty or compatibility.`,
  `${quote2} This training reference distinguishes a label transcription from a purchasing decision.
  Characters, separators and suffixes can be recorded in the identification field as they appear.
  The example form includes separate fields for the equipment description and an attached photograph.
  A label may contain several identifiers, so describe which field was transcribed.
  The document does not assign a replacement interval or recommend a particular installation method.
  Unclear markings are recorded as unresolved and referred for technical clarification.
  An order confirmation and a supplier response belong with the request record.
  These notes are not evidence of availability, commercial terms or vehicle fitment.`,
];
export function realisticDraft() {
  return {
    title: "Preparing a brake component enquiry when the identification is unclear",
    excerpt: "Build a useful brake component enquiry from vehicle records, label photographs and a clear list of unresolved questions before requesting a quote.",
    metaTitle: "Preparing a clear brake component enquiry",
    metaDescription: "Organize vehicle records, component identification and unanswered questions into a useful enquiry, then confirm fitment and availability before ordering.",
    content: `<h2>Start with what you can document</h2>
<p>A brake component enquiry is easier to discuss when the request separates observations from assumptions.
Before choosing a catalog item, assemble a short record of what you actually know and what still needs checking.
You do not need to turn that record into a technical diagnosis. Its purpose is to give the next person a
consistent starting point and make missing information visible rather than hide it behind a confident description.</p>
<p>${quote1} The <a href="${fixtureUrls[0]}">vehicle identification reference</a>
provides that recordkeeping principle. Treat it as a prompt to organize the enquiry, not as approval to fit
a particular component. An old invoice, a workshop note and a photograph may tell different parts of the
story; keeping them together helps you ask why they differ without assuming that any one document settles
the question.</p>
<h2>Make uncertainty easy to see</h2>
<p>Prepare two lists. On the first, put details you can read clearly from the vehicle record or component.
On the second, put questions that require confirmation. If a photograph is blurred, mark the character as
uncertain rather than guessing. If several identifiers appear on a label, describe where each one is
printed. Avoid combining fragments from different documents into a new identifier that appears more
complete than the evidence actually allows.</p>
<p>${quote2} This is the identification step described in the
<a href="${fixtureUrls[1]}">component reference</a>. It does not mean that a visible marking alone
proves replacement suitability. Ask the technical contact to explain any proposed substitution and to
identify the documentation supporting it. A clear question can be more useful than a premature conclusion,
especially when different records use different descriptions for the same enquiry.</p>
<h2>Use a request checklist, not a fitment promise</h2>
<ul><li>Describe the component being discussed in plain language and attach the relevant photographs.</li>
<li>Keep the vehicle reference separate from the component marking so neither is mistaken for the other.</li>
<li>List the unresolved characters, document conflicts or missing details that need clarification.</li>
<li>Ask what additional information is needed before a specific replacement can be confirmed.</li>
<li>Record the response against the original question instead of overwriting the original observation.</li></ul>
<p>The public <a href="/product/brake-fixture">brake catalog entry</a> is a starting point for a conversation,
not evidence of availability or suitability for your vehicle. Use catalog descriptions to explain the
category you are discussing. Do not treat a familiar name or an apparently similar photograph as a complete
technical comparison. Keep any quoted commercial terms alongside, but separate from, the technical
questions so a price discussion does not silently settle an unresolved specification.</p>
<h2>Close the enquiry with a clear next step</h2>
<p>Before placing an order, read the reply against your unanswered questions. If an important point remains
open, ask for clarification in the same conversation and retain the supporting response. Consider recording
who will check the information and what document they need, rather than allowing a general acknowledgment
to stand in for a specific answer. This creates a practical handover between the person gathering details
and the person reviewing the proposed part.</p>
<p>This checklist does not provide installation instructions, replacement intervals or a compatibility
decision. Those matters need the applicable technical documentation and appropriate review. When your
record is ready, <a href="/contact">request a quote from Narmada Mobility</a> and ask the team to confirm
fitment and availability. Include the unresolved questions so the response can address them directly
instead of requiring another round of guesswork.</p>`,
    claims: [
      { claim: quote1, sourceUrl: fixtureUrls[0], evidenceQuote: quote1 },
      { claim: quote2, sourceUrl: fixtureUrls[1], evidenceQuote: quote2 },
    ],
    productSlugs: ["brake-fixture"], improvementSummary: "",
    followUpTopics: [{ title: "How should unresolved identification characters be recorded in an enquiry?",
      sourceUrl: fixtureUrls[1], evidenceQuote: quote2 }],
  };
}
