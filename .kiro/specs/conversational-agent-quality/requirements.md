# Requirements Document

## Introduction

DecodificaIA is a WhatsApp pre-sales agent for Decodifica that qualifies inbound leads and, when appropriate, hands them off to the human commercial team. The current conversational logic produces a poor experience: it deflects direct questions (especially about price), emits responses that do not match the user's last message, mishandles commands and edge inputs (for example `/clear`), repeats the same offers in evasive loops, ignores the user's stated preference (such as wanting to keep talking instead of being handed off), and sounds robotic despite promising a "humanized" experience.

This feature redesigns the conversational behavior of the agent so that it answers direct questions appropriately, stays on-topic with the conversation, handles commands and edge inputs predictably, avoids repetition and evasion, honors the user's stated preferences, and maintains a natural tone — while preserving its core jobs of qualifying leads and handing off at the right moment.

The scope of this feature is the conversational decision and response logic in `apps/api/src/agent/` (intent classification, fact extraction, reply generation, response guarding, output normalization) and the orchestration in `apps/api/src/conversation/`. It does not cover infrastructure, the WhatsApp transport layer, the dashboard, or the underlying LLM provider implementation.

## Glossary

- **Agent**: The DecodificaIA conversational system that receives user messages and produces replies. The umbrella system that owns all behavior below.
- **Inbound_Message**: A single message received from the user, consisting of text content.
- **Direct_Question**: An Inbound_Message that explicitly requests a specific piece of information from the Agent (for example price, timeline, scope, or how the solution works), phrased as a question or an explicit request to know something.
- **Price_Question**: A Direct_Question whose subject is cost, price, value, fee, or budget range for the service.
- **Intent_Resolver**: The Agent component that assigns each Inbound_Message exactly one intent category.
- **Context_Tracker**: The Agent component that maintains and exposes the set of facts already established in the conversation (segment, WhatsApp usage, pains, volume, role, handoff state) and what the Agent has already said.
- **Command**: An Inbound_Message whose text begins with the `/` character and matches a defined command keyword (for example `/clear`, `/reset`, `/help`).
- **Edge_Input**: An Inbound_Message that is not natural conversational language and not a defined Command — for example empty-after-trim text, whitespace only, emoji-only, a single punctuation mark, an undefined `/` token, or content exceeding the supported length.
- **Response_Composer**: The Agent component that produces the user-facing reply text.
- **Handoff**: The act of routing the lead and a context summary to the human commercial team.
- **Handoff_Manager**: The Agent component that decides when Handoff is offered, accepted, and completed, and tracks Handoff state.
- **Handoff_State**: One of `none`, `suggested`, `accepted`, or `completed`.
- **Stated_Preference**: An explicit user statement about how the user wants the conversation to proceed (for example "I want to keep talking with you", "I don't want to be transferred", or "I want a human now").
- **Lead_Qualifier**: The Agent component that derives lead score, temperature, and qualification fields from established facts.
- **Repetition**: A reply whose primary content (offer, question, or explanation) is semantically equivalent to a reply the Agent has already sent in the same conversation.
- **Conversation_History**: The ordered list of all user and Agent messages exchanged in the conversation.
- **Pricing_Config**: The configurable setting that determines whether a price range is available to share and, if so, its starting-price text.

## Requirements

### Requirement 1: Answer direct questions on-topic

**User Story:** As a prospective customer, I want the Agent to actually address the question I asked, so that I get the information I came for instead of an unrelated reply.

#### Acceptance Criteria

1. WHEN an Inbound_Message is classified as a Direct_Question, THE Response_Composer SHALL produce a reply that addresses the subject of that Direct_Question.
2. WHEN an Inbound_Message is classified as a Direct_Question, THE Response_Composer SHALL NOT replace the answer with an unrelated statement about a different topic.
3. IF the Agent cannot fully answer a Direct_Question with the information available, THEN THE Response_Composer SHALL acknowledge the specific subject of the question and state what is needed to answer it.
4. WHEN the Agent provides an answer to a Direct_Question and also asks a follow-up question in the same reply, THE Response_Composer SHALL place the answer before the follow-up question.

### Requirement 2: Handle price questions without deflecting

**User Story:** As a prospective customer, I want a useful response when I ask about price, so that I understand the cost basis even if a final number depends on scope.

#### Acceptance Criteria

1. WHEN an Inbound_Message is classified as a Price_Question, THE Response_Composer SHALL acknowledge the price intent in the reply.
2. WHERE Pricing_Config has a price range enabled, WHEN an Inbound_Message is classified as a Price_Question, THE Response_Composer SHALL include the configured starting-price text in the reply and SHALL exclude any artificial-intelligence behavior explanation and any refusal to discuss price.
3. WHERE Pricing_Config has no price range enabled, WHEN an Inbound_Message is classified as a Price_Question, THE Response_Composer SHALL state that a final value depends on scope and offer to route the lead to the team for a direct estimate.
4. IF an Inbound_Message is classified as a Price_Question, THEN THE Response_Composer SHALL NOT reply with the artificial-intelligence behavior explanation as the response to the price intent.
5. WHEN an Inbound_Message is classified as a Price_Question, THE Response_Composer SHALL NOT state or imply a refusal to discuss price.

### Requirement 3: Maintain conversational context

**User Story:** As a user in an ongoing conversation, I want each reply to relate to what I just said, so that the conversation feels coherent.

#### Acceptance Criteria

1. WHEN the Agent generates a reply, THE Response_Composer SHALL produce a reply that relates to the most recent Inbound_Message or to the established facts in Context_Tracker.
2. WHILE facts exist in Context_Tracker, THE Response_Composer SHALL NOT ask the user for a fact that is completely known and unambiguous in Context_Tracker.
3. WHEN the Agent generates a reply, THE Response_Composer SHALL produce a reply that is consistent with the established Handoff_State in Context_Tracker.
4. IF the LLM produces an empty or unparseable response, THEN THE Response_Composer SHALL produce a contextual fallback reply derived from the established facts in Context_Tracker.

### Requirement 4: Handle defined commands gracefully

**User Story:** As a user, I want commands like `/clear` to do something predictable, so that I am not met with a confused reply.

#### Acceptance Criteria

1. WHEN an Inbound_Message is a defined Command, THE Agent SHALL execute the action mapped to that Command.
2. WHEN the Agent executes a defined Command, THE Response_Composer SHALL return a confirmation reply that names the action performed.
3. WHEN an Inbound_Message is a defined Command, THE Agent SHALL NOT route the Command text to the LLM as conversational input.
4. IF an Inbound_Message begins with `/` but matches no defined Command, THEN THE Response_Composer SHALL return a reply listing the available commands.

### Requirement 5: Handle edge inputs gracefully

**User Story:** As a user, I want the Agent to respond sensibly when I send an empty, malformed, or non-textual message, so that the conversation does not break.

#### Acceptance Criteria

1. IF an Inbound_Message is an Edge_Input, THEN THE Response_Composer SHALL return a reply that invites the user to restate the request in words.
2. IF an Inbound_Message is an Edge_Input, THEN THE Agent SHALL preserve the existing established facts in Context_Tracker.
3. IF an Inbound_Message content length exceeds the supported maximum, THEN THE Agent SHALL reject the message with a reply stating the supported length limit.
4. IF an Inbound_Message is an Edge_Input, THEN THE Response_Composer SHALL NOT return a reply that states the Agent is having difficulty processing.

### Requirement 6: Avoid repetitive and evasive replies

**User Story:** As a user, I want the Agent to move the conversation forward, so that I am not stuck hearing the same offer or question repeatedly.

#### Acceptance Criteria

1. WHEN the Agent generates a reply, THE Response_Composer SHALL produce a reply that is not a Repetition of any reply already present in Conversation_History.
2. IF the only available next reply would be a Repetition of a prior offer, THEN THE Response_Composer SHALL either answer the user's pending question or advance to a different conversational step.
3. WHEN the Agent has already offered a demonstration or simulation once in the conversation, THE Response_Composer SHALL NOT offer a demonstration or simulation again unless the user requests one.
4. WHEN the user asks a question that the Agent has not yet answered, THE Response_Composer SHALL answer that question rather than redirect to an offer.

### Requirement 7: Respect the user's stated preference

**User Story:** As a user, I want the Agent to honor what I say about how I want to proceed, so that I stay in control of the conversation.

#### Acceptance Criteria

1. WHEN an Inbound_Message contains a Stated_Preference to continue talking with the Agent, THE Handoff_Manager SHALL set Handoff_State to `none` and the Response_Composer SHALL continue the conversation.
2. WHILE the user's most recent Stated_Preference is to continue talking with the Agent, THE Response_Composer SHALL NOT offer or initiate Handoff.
3. WHEN an Inbound_Message contains a Stated_Preference to speak with a human, THE Handoff_Manager SHALL set Handoff_State to `accepted`.
4. IF an Inbound_Message contains a Stated_Preference that conflicts with the current Handoff_State, THEN THE Handoff_Manager SHALL apply the most recent Stated_Preference.

### Requirement 8: Maintain a natural, humanized tone

**User Story:** As a user, I want replies that sound like a helpful person, so that the experience matches the promised humanized service.

#### Acceptance Criteria

1. WHEN the Response_Composer produces a reply, THE Response_Composer SHALL write the reply in conversational Portuguese that directly references the user's topic.
2. WHEN the Response_Composer produces a reply, THE Response_Composer SHALL limit the reply to one question.
3. WHEN the Response_Composer produces a reply, THE Response_Composer SHALL exclude internal field values, internal state labels, and system identifiers from the reply text.
4. IF a reply contains a broken or truncated sentence fragment, THEN THE Response_Composer SHALL repair the reply into a complete sentence before delivery.

### Requirement 9: Continue qualifying leads

**User Story:** As the Decodifica commercial team, I want the Agent to keep qualifying leads during natural conversation, so that we receive scored, summarized leads.

#### Acceptance Criteria

1. WHEN the Agent processes an Inbound_Message, THE Lead_Qualifier SHALL update the lead score from the established facts in Context_Tracker.
2. WHEN the Lead_Qualifier updates the lead score, THE Lead_Qualifier SHALL set the lead temperature consistent with the lead score.
3. WHILE a conversation is active and not abandoned, THE Lead_Qualifier SHALL NOT decrease the lead score below its previously recorded value.
4. WHEN a new fact about the lead is established in Context_Tracker, THE Lead_Qualifier SHALL persist that fact to the lead record.

### Requirement 10: Hand off at the appropriate time

**User Story:** As the Decodifica commercial team, I want the Agent to hand off only when it makes sense, so that we receive qualified leads with enough context and no premature transfers.

#### Acceptance Criteria

1. WHEN the user explicitly requests a human or a proposal, THE Handoff_Manager SHALL offer or confirm Handoff regardless of qualification progress.
2. IF the established facts in Context_Tracker do not include a business segment and at least one pain, THEN THE Handoff_Manager SHALL NOT initiate an unsolicited Handoff offer.
3. WHEN the user accepts a Handoff offer, THE Handoff_Manager SHALL set Handoff_State to `accepted` and the Response_Composer SHALL confirm the Handoff in the reply.
4. WHILE Handoff_State is `completed`, IF an Inbound_Message is a simple acknowledgment, THEN THE Response_Composer SHALL reply that the case was already routed to the team.
5. WHILE Handoff_State is `completed`, IF an Inbound_Message is a new Direct_Question, THEN THE Response_Composer SHALL answer the question and note that the team can give further detail on contact.
6. WHEN the Handoff_Manager sets Handoff_State to `accepted` or `completed`, THE Handoff_Manager SHALL keep Handoff_State at `accepted` or higher for the remainder of the conversation unless the user abandons the conversation.
