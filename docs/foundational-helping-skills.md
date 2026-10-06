# Foundational helping skills: reference

> **What this is.** Ally's reference for the foundational helping skills: the behaviours
> every helping conversation needs, whatever the scenario, course or competency being
> practised. It is the single source for the platform's **scenario-independent** measure of
> whether learners are getting better (`src/foundational-skills`, the Priority-tab chart
> AAQ-166). When a session is told to "refer to the foundational skills doc", this is the file.
>
> **How to use it.** §1 is the TL;DR. §3 is the scoring rule and §4 the full rubric, which
> are what code usually needs. §5 covers what good looks like for each skill. §8 explains how
> the measure is built, and §9 maps it onto the rest of the codebase, **including where
> Ally's seeded competencies differ from this rubric**. Read §9 before touching competency,
> behaviour or scoring code.
>
> The code copy of the rubric is `src/foundational-skills/constants/helping-skills-rubric.constants.ts`.
> If this doc and that file disagree, the file is what production scores with. Fix whichever
> is wrong, and bump `FHS_RUBRIC_VERSION` if it is the file.

---

## 0. Contents

1. TL;DR
2. Core concepts (skills, the three tiers, competency-based practice)
3. The scoring rule and feedback rules
4. The rubric: all skills, behaviours, and simulated-client instructions
5. Skill by skill: what good looks like
6. Attitude blockers: could help, should help, ready to help
7. Practice and assessment role-plays
8. The passive measure (`src/foundational-skills`)
9. Mapping to the rest of the codebase, and known divergences
10. Design principles for features built on this
11. Glossary

---

## 1. TL;DR

1. There are **15 foundational helping skills** in **3 tiers: Engage → Understand → Support.**
   Almost every helper needs some of Engage; people in mental-health and psychosocial roles
   need most of them.
2. Each skill is scored from a **checklist in three columns**: *unhelpful or potentially
   harmful*, *basic*, *advanced*. A rater ticks what they observe, and **a level 1–4 is
   derived** from the ticks:
   - **1**: *any* unhelpful behaviour. **This overrides everything else.**
   - **2**: no unhelpful behaviour, but not every basic behaviour (none, or only some).
   - **3**: no unhelpful behaviour and **every** basic behaviour.
   - **4**: level 3 plus **at least one** advanced behaviour.
3. **There is no pass or fail.** The output is feedback, always given in the order
   **strengths → specific improvements with a way to practise → a positive close.** Feedback
   to a group names trends, never individuals.
4. **Safety-critical skill: assessing harm** (`harm`). Asking about suicide does not raise
   the risk. Imminent risk has explicit criteria (§5.7). The response is to keep the person
   safe, tell a supervisor immediately, follow the organisation's procedure, and never leave
   the person alone.
5. **Never promise confidentiality without exceptions.** An unconditional promise is itself
   an unhelpful behaviour.
6. Attitude matters as much as technique. **"Could help / should help / ready to help"**
   (§6) are the three blockers to clear.
7. **Ally's passive measure** (§8) scores 14 of the 15 skills from roleplay transcripts.
   Non-verbal communication is excluded because it can't be seen in text. It scores fixed
   5,000-character slices of each learner's own speech with an LLM judge that ticks
   behaviours with quoted evidence, and **code** derives the levels.
8. Ally's seeded roleplay competencies are **not** this rubric. Their "Linking Emotions,
   Thoughts & Behaviours" is a different skill from `functioning`, and they merge basic and
   advanced into one `SHOULD_DO` bucket. See §9.

---

## 2. Core concepts

### 2.1 Foundational helping skills
Foundational helping skills are behaviours that strengthen the relationship between a helper
and the person being helped. They build trust and support emotional wellbeing. They go by
other names too: basic helping skills, psychosocial support skills, common factors, general
principles of care. They apply across health, education and social care. They are **not** a
counselling qualification and **not** a specific psychological intervention;
intervention-specific techniques (e.g. stress management) sit on top of them.

**Competency** means how well a skill is performed: it is observable, trainable, durable and
measurable. Competency-based practice watches behaviours in structured role-plays, finds the
gaps, and spends practice time where it's needed. It builds on strengths rather than
re-teaching what a learner already does well.

### 2.2 The three tiers

| Tier | Skills (code key) | Role |
|---|---|---|
| **Engage** | Non-verbal (`non-verbal`, reference only), Verbal (`verbal`), Confidentiality (`confidentiality`), Rapport (`rapport`), Explore & normalise feelings (`feelings`), Empathy (`empathy`), Harm assessment & safety (`harm`) | Build the relationship that makes help possible |
| **Understand** | Impact on daily life (`functioning`), Explanation of the problem (`explanation`), Family & trusted people (`family`), Coping (`coping`), Psychoeducation (`psychoeducation`) | Understand the problem from the person's side |
| **Support** | Collaborative goals (`goals`), Realistic hope (`hope`), Eliciting feedback (`feedback`) | Move toward change together |

**Staged rule:** when time is short, teach and measure Engage first. Without it nobody can be
helped. Add Understand and Support by role: a community worker might need engage →
understand → psychoeducation → family → hope, while a teacher might need engage → understand
→ functioning → family.

---

## 3. The scoring rule

### 3.1 The exact rule

```text
for each skill assessed:
    ticked = every behaviour observed
    if any(b in UNHELPFUL for b in ticked):              level = 1   # overrides everything
    elif not REQUIRED_BASIC.issubset(ticked):            level = 2   # none or some basics
    elif not any(b in ADVANCED for b in ticked):         level = 3   # all basics, no advanced
    else:                                                level = 4   # all basics + ≥1 advanced
```

This is `deriveLevel` in `src/foundational-skills/util/skill-scoring.util.ts`. What it implies:

- **Level 1 ignores helpful behaviours.** One unhelpful behaviour makes the skill a 1, however
  much else went well.
- **Advanced behaviours count only once every basic is present.** Some basics plus an advanced
  behaviour is still a 2.
- **Level 2 is wide**: it covers everything from doing nothing to missing one basic. *Which*
  basic is missing is more useful than any count.
- Each skill gets exactly one level, and skills are scored independently. The ruler defines
  **no aggregate**; Ally's composite (the mean of the skills it assessed) is a product choice
  on top of it.
- **Score only what the situation called for.** A skill whose opportunity never arose is *not
  assessed*, which is different from scoring 2. In a practice round, score only the skills
  that were taught.
- "Inappropriate physical contact", eye contact and appropriate language are **culturally
  defined**. The organisation decides what counts.

Two refinements Ally's transcript judge adds (§8):
- **Absence behaviours** ("does not ask about self-harm") are only marked when the
  opportunity clearly arose *and* the helper had room to act on it.
- **Conditional basics** react to something only the client can supply: adapting to feedback
  the client gave, or praising a positive coping strategy the client mentioned. If the client
  never supplied it, the behaviour is marked not applicable and dropped from the "every basic"
  requirement.

### 3.2 Feedback rules
Feedback to an individual:
1. Start with strengths (skills at level 2–4).
2. Then give improvements, especially any **level 1** behaviour. Name the specific behaviour
   you saw, ask the learner how they'd do it differently, and suggest a way to practise.
3. **Always end positive**, on overall progress.

Feedback to a group follows the same order but talks only about trends and **never
identifies anyone**. Unhelpful behaviours must be addressed, but framed as development,
never as failure.

---

## 4. The rubric

Keys and codes below are the stored ones (`<skill>.<u|b|a><n>`). ✗ = unhelpful or
potentially harmful (any one → 1). ✓ = basic (all required for 3). ★ = advanced (any one on
top of all basics → 4). **Opportunity** is when the skill is assessable at all. **Simulated
client** is how a practice client (human or AI) should behave so the skill becomes
observable, which is directly useful when writing AI personas.

### `non-verbal`: Non-verbal communication *(Engage; reference only, not transcript-scored)*
- ✗ Doing other things during the conversation (phone, paperwork) · laughing at the client ·
  inappropriate facial expressions · inappropriate physical contact
- ✓ Allows silences · appropriate eye contact · open posture (body turned toward the client) ·
  continuous supportive body language (nodding) and small sounds ("uh-huh")
- ★ Varies body language to match the client's content and expression
- Simulated client: at suitable moments, use culturally appropriate body language for sadness
  or worry.
- Why it's excluded from Ally's measure: every behaviour is visual, and its voice analogues
  (tone, pitch, pacing) don't survive into a transcript.

### `verbal`: Verbal communication *(Engage)*
- Opportunity: always, whenever the helper speaks.
- ✗ `u1` many suggestive or leading closed questions ("You didn't really want to do that,
  right?") · `u2` correcting ("What you really mean is…") or accusing ("You shouldn't have
  said that") · `u3` culturally or age-inappropriate language
- ✓ `b1` open-ended questions · `b2` summarising or paraphrasing
- ★ `a1` encourages them to keep explaining ("Tell me more about…") · `a2` clarifies in the
  first person ("I heard you say…")
- Not text-assessable: interrupting, letting the client finish before responding, matching
  the client's rhythm.
- Simulated client: answer closed questions ("Do you / did you / can you…?") with short yes/no
  answers, and open ones ("Tell me about…") with detail.

### `confidentiality`: Explain and promote confidentiality *(Engage)*
- Opportunity: the client raises a privacy concern, or the helper brings confidentiality up.
- ✗ `u1` forcing disclosure · `u2` describing it inaccurately ("I'll only tell your family") ·
  `u3` **promising full confidentiality with no exceptions** · `u4` minimising privacy
  concerns ("It doesn't matter if anyone hears")
- ✓ `b1` explains the concept · `b2` lists exceptions (self-harm, harm to others) · `b3`
  explains *why* confidentiality can need breaking
- ★ `a1` details the referral process or chain of communication · `a2` checks the client
  understood · `a3` keeps topics appropriate to how private the setting is
- Simulated client: at some point ask "Are you going to tell anyone what I tell you?"

### `rapport`: Rapport-building and self-disclosure *(Engage)*
- Opportunity: the window contains the opening of a session.
- ✗ `u1` dominating with a personal story · `u2` minimising the problem by describing how the
  helper handled it · `u3` unnecessary embarrassing personal questions · `u4` discussing
  other clients' confidential information
- ✓ `b1` introduces self and role · `b2` casual informal conversation · `b3` asks the client's
  name and what they prefer to be called · `b4` shares *general* experience related to the
  client (their community or region), never personal problems
- ★ `a1` asks the client to reflect on what the helper shared · `a2` checks the client's
  comfort (preferred language, is now a good time)
- Simulated client: don't give your name or personal details unless asked.

### `feelings`: Exploration and normalisation of feelings *(Engage)*
- Opportunity: the client describes a difficulty, a distressing situation or an emotional
  reaction.
- ✗ `u1` saying the reaction is unusual ("People don't usually react this way") · `u2`
  minimising or dismissing feelings · `u3` forcing the client to describe emotions
- ✓ `b1` appropriately encourages sharing feelings · `b2` normalises (others have similar
  reactions after similar experiences) · `b3` asks how it felt to share
- ★ `a1` explores hesitance to share · `a2` validates while reframing a potentially harmful
  reaction
- Not text-assessable: commenting on facial expression.
- Simulated client: don't share feelings unless asked.

### `empathy`: Empathy, warmth and genuineness *(Engage)*
- Opportunity: the client shares a concern, a problem or an emotion.
- ✗ `u1` critical of the client's concerns · `u2` dismissive of them · `u3` an emotional
  response that reads as fake or acted (formulaic sympathy that ignores what was said)
- ✓ `b1` warm, friendly, genuine throughout · `b2` continuously shows concern ("That sounds
  sad. Can you tell me more?") · `b3` asks questions to identify the emotion ("I wonder if you
  felt sad or angry…")
- ★ `a1` asks the client to reflect on the helper's empathic statements ("What did you think
  when I said you sounded sad?")
- Simulated client: show sadness or worry, and describe sadness when asked.

### `harm`: Assessment of harm and a response plan *(Engage; safety-critical)*
- Opportunity: the client gives a cue of hopelessness, wishing not to be alive, self-harm,
  suicide, or harm to or from others, or the helper raises it.
- ✗ `u1` **does not ask about self-harm after such a cue** (absence) · `u2` lectures with
  religious or legal reasons ("This is a sin") · `u3` disbelief ("You're saying it for
  attention") · `u4` encourages keeping it secret
- ✓ `b1` asks about self-harm or harm to others, or explores it when raised · `b2` asks about
  current intent, plans or means, or prior attempts
- ★ `a1` explores risk and protective factors (reasons for living, who supports them) · `a2`
  agrees a safety or response plan (supervisor, trusted person, removing means, follow-up)
- Simulated client: say "Sometimes when I go to sleep, I wish I wouldn't wake up." If asked
  about hurting yourself: "Sometimes I think about dying, but I wouldn't hurt myself on
  purpose." Reasons for living: "I want to stay alive for my family." Prior attempts: "No,
  never."

### `functioning`: Impact on daily life and social functioning *(Understand)*
- Opportunity: the client describes a personal problem or distress of their own.
- ✗ `u1` criticising the client for letting symptoms affect functioning ("You're weak") ·
  `u2` saying there's no connection, **or never asking** how it affects daily life (absence)
  · `u3` criticising them for the impact on family · `u4` making them feel guilty about it
- ✓ `b1` asks about daily functioning (work, sleep, self-care, relationships) · `b2` discusses
  the link between functioning and how they feel
- ★ `a1` supports or reframes the client's own links · `a2` explores the link **both ways** ·
  `a3` asks about history ("How long has this been going on?")
- Simulated client: if asked about daily life, say worry or sadness makes ordinary things
  hard (self-care, looking after children or family).

### `explanation`: The client's explanation of the problem *(Understand)*
- Opportunity: the client's problem is being discussed.
- ✗ `u1` criticising the client's view as ignorant or superstitious · `u2` endorsing harmful
  beliefs held by them or their network
- ✓ `b1` asks what they think causes it · `b2` asks what family or friends think
- ★ `a1` uses their view of the cause in planning, without harm · `a2` discusses alternatives
  to a harmful explanation · `a3` addresses differences between their view and others'
- Simulated client: offer mixed causes ("Maybe it's because I lost my job… or maybe I'm
  cursed"). If asked what family think, give a different cause ("They think I'm weak and
  lazy").

### `family`: Involving family and trusted people *(Understand)*
- Opportunity: family or close people come up, or support options are discussed.
- ✗ `u1` telling them not to involve anyone · `u2` forcing involvement · `u3` saying they'll
  contact family without permission · `u4` letting an accompanying person speak for or
  override the client
- ✓ `b1` asks about close people · `b2` asks how they'd like those people involved · `b3` asks
  who they live with
- ★ `a1` explores their reasons for involving someone or not · `a2` rehearses the conversation
  (the helper plays the family member)
- Simulated client: name immediate family as close people, but a *different* person (an aunt,
  a neighbour) as the one you'd like involved.

### `goals`: Collaborative goal-setting *(Support)*
- Opportunity: the client states a goal or expectation, or the talk turns to what they want or
  to next steps.
- ✗ `u1` saying a goal can't be met without giving a reason · `u2` incorrect, misleading or
  unrealistic information about what help can achieve · `u3` dictating the goal
- ✓ `b1` asks about their goals and expectations · `b2` explains how those goals fit what
  you'll work on together
- ★ `a1` prioritises or adapts the plan to their goals · `a2` reframes a goal within scope
  ("Your goal is a job. Could we work on something that helps you get there?")
- Simulated client: first ask for something out of scope ("Get me a job"). If steered, offer a
  psychosocial goal ("Worry less so I can plan my job search").

### `hope`: Promoting realistic hope *(Support)*
- Opportunity: the client expresses doubt or hopelessness, or asks whether things will get
  better or whether the help will work.
- ✗ `u1` negative remarks about their doubts ("How can you get better with no hope?") · `u2`
  unrealistic promises ("Everything will be fixed") · `u3` no hope at all ("This can't be
  solved")
- ✓ `b1` explains how change is possible · `b2` praises them for seeking help
- ★ `a1` explores their doubts · `a2` shares reasons for hope from experience or from the
  client's own behaviour · `a3` discusses reasons for hope when they're doubtful
- Simulated client: ask "Will meeting you fix everything / get me a job?", and mention
  something that gives hope ("I did it before") and something that takes it away ("Nothing
  works").

### `coping`: Coping and prior solutions *(Understand)*
- Opportunity: the client's problem is being discussed.
- ✗ `u1` negative remarks about their coping ("That would never work") · `u2` encouraging
  harmful coping
- ✓ `b1` asks about current or past coping · `b2` praises positive, safe solutions
  (conditional: only when the client mentioned one)
- ★ `a1` encourages keeping up positive coping · `a2` reflects on unhealthy strategies and
  brainstorms alternatives *with* them
- Simulated client: mention positive coping (gardening, walks) and negative coping (yelling,
  alcohol).

### `psychoeducation`: Psychoeducation in plain, local terms *(Understand)*
- Opportunity: the helper explains a symptom, stress reaction, condition or treatment, or the
  client asks what's happening to them.
- ✗ `u1` technical terms without checking understanding · `u2` stigmatising terms
- ✓ `b1` accurate explanation in simple terms · `b2` uses local concepts or everyday words
- ★ `a1` builds on the client's own description or metaphor · `a2` checks understanding
- Simulated client: whenever the helper uses jargon, ask "What does that mean?"

### `feedback`: Eliciting feedback *(Support)*
- Opportunity: the helper offers a suggestion, advice, a plan or an explanation.
- ✗ `u1` lecturing without asking what they think · `u2` negative or harmful suggestions
- ✓ `b1` asks whether the suggestions help ("How does that sound?") · `b2` adapts, clarifies or
  offers alternatives based on the answer (conditional: only when the client gave feedback to
  adapt to)
- ★ `a1` summarises their feedback and checks the interpretation
- Simulated client: when asked, say "Some are helpful, but some seem too hard for my
  situation", then ask for other options.

---

## 5. Skill by skill: what good looks like

### 5.1 Non-verbal
An upright but not rigid posture, appropriate eye contact, nods and open hands, small sounds,
and a short pause before responding. Poor body language makes people feel unheard and less
willing to share. Behaviours must fit the local culture.

### 5.2 Verbal
- Introduce yourself and ask what they like to be called.
- **Open questions** leave room to explore: "How do you feel?" rather than "Are you sad?", and
  "How would you feel about asking your wife?" rather than "Can you ask your wife?".
- **Closed questions are for confirming, summarising** and untangling contradictions.
- **Reflect** what you heard: "I heard you say you felt sad you couldn't get out of bed…".
- **Allow time.** Don't respond mid-sentence. A pause often surfaces the real story ("I was so
  happy… I thought they'd offer me the job, but someone else got it").
- Avoid: interrupting, leading questions, correcting, accusing, and jumping to direct advice.

### 5.3 Rapport
Put the person at ease with polite, culturally expected talk and attention that doesn't
intrude. Introduce yourself, ask their preferred name, make light small talk (nothing
political), and share general things about yourself. **Avoid** disrespectful terms (calling a
man "boy"), dominating with your own story, minimising the problem as easy to solve,
embarrassing questions, and describing how other named people handled something similar,
which also breaches confidentiality.

### 5.4 Confidentiality and privacy
- Confidentiality is an **agreement made early**, not left until something sensitive comes
  up, about what will and won't be shared. Nothing goes to family, friends or employers
  without **informed consent**. People have the right not to share, including with you.
- **State the exceptions**: supervision (often anonymised, and the supervisor follows the same
  rules), risk of harm to self or others, someone harming the person, and **local legal
  duties** (child abuse, violence, neglect). Mandated reporting can conflict with person-centred
  care, so explain the limits and let the person choose what to disclose.
- A good first explanation covers: who you are and your organisation, the purpose and length
  of the session → confidentiality → its exceptions → **the chain of communication** (me → my
  supervisor → in serious cases, others who can help) → **why** it's shared ("to keep you
  safe") → **checking understanding and consent**.
- **Privacy is part of confidentiality.** Remotely, use headphones or a quiet room. If family
  are nearby, move somewhere private or postpone sensitive topics. In a busy clinic, find a
  quiet corner.
- Worked case: a 20-year-old whose mother insists on hearing everything, in an office where
  the door can't be closed. The barriers are family listening in and being overheard. The
  actions are to change topics when needed and to explain the service's confidentiality rules
  to the family.

### 5.5 Empathy
- Empathy means seeing the situation from their side. **Listen without judgement**, setting
  your own values aside (take a clash of values to supervision), then show care actively and
  continuously, both non-verbally and verbally.
- **Reflect tentatively**, because you may be wrong or they may not yet know what they feel:
  "Have I understood that this made you feel scared?", "I wonder if you felt sad or angry?".
  Avoid "You must have been embarrassed."
- A useful exercise: have the "client" act out an emotion without naming it, which simulates
  someone who can't put words to what they feel.

### 5.6 Exploring and normalising feelings
- **Validate** by explicitly acknowledging the feeling: "I can see you're very distressed",
  "This seems really hard for you".
- **Don't** presume ("You must have felt sad"), claim to know ("I know how you feel"), project
  ("I'd have been upset"), judge ("You're overreacting") or make it about yourself. **Avoid "I
  understand how you feel"**: it invites "How could you possibly know?"
- **Normalise** *after* validating: the reaction is understandable and others feel the same,
  **without trivialising their experience**.
- **The three-part response: validate → normalise → invite reflection.** For example: "That
  sounds really hard [validate]. Many people who lose their job feel ashamed [normalise]. How
  does it feel to know others react like this too? [reflect]"

### 5.7 Harm and safety (safety-critical)
**Scope.** This skill covers identifying imminent risk of self-harm or suicide, referral, and
supervisor involvement. **Harm to or from others needs its own protocols** (protection
services, gender-based-violence services, authorities). Organisations must adapt the
procedure to local law.

**Definitions.** *Suicide* is deliberately ending one's life. *Self-harm* is intentional
self-inflicted poisoning or injury, with or without intent to die. Suicidal behaviour runs
from thoughts ("I wish I'd go to sleep and not wake up" through to "I want to die today") to
planning (vague, or specific about when, where and how), to an attempt, to death. *Means* are
things like pesticides, medication and firearms, and vary by place.

**Language.** Don't say "commit suicide", "successful/unsuccessful attempt" or "completed
attempt". Say **"died by suicide"** or **"took their own life"**.

**Things to know.** Suicide is preventable, through support at the right time and by
restricting lethal means. **Talking about it doesn't cause it**; it gives more options and
more time. People who are suicidal are often **ambivalent** and want relief from pain. Many
have no diagnosed mental-health condition, and there is never a single cause.

**When to ask.** You don't need to ask everyone. Ask when someone presents with a
mental-health condition, acute distress, chronic pain, a history of attempts, or **warning
signs**: severe mood change, withdrawal, talking about ending their life ("no one would miss
me", "no reason to live"), looking for means, saying goodbye, giving possessions away. Warning
signs don't predict outcomes, so assess each person.

**How to ask:** openly, directly and without judgement, normalising the question first. For
example: "When people face what you're facing, they sometimes think about hurting themselves
or ending their life. It's common, so I ask everyone. Have you had thoughts like that?" Then
**confirm what you heard** and **leave the door open**: "I may ask again. If thoughts like
this come, please tell me."

**If they report thoughts,** ask gently about **current plans and access to means (when,
how)** and about **prior attempts**.

**Imminent-risk criteria.** Someone is at imminent risk if **any** of these hold:
1. **current** thoughts of self-harm or suicide ("I want to kill myself today"), **or**
2. a **current plan**, **or**
3. they are **now extremely agitated, violent, distressed or not communicating**, **and** have
   any one of: thoughts of self-harm in the **past month**, a plan in the **past month**, or
   an act of self-harm in the **past year**.

**Responding to imminent risk:**
- follow the organisation's procedure and **tell your supervisor immediately**;
- **don't leave them alone**; create a safe, supportive setting;
- involve someone they trust ("Who in your community can help keep you safe?");
- check access to means and arrange for it to be removed (given to a neighbour, poured away,
  put out of reach);
- tell them they're not alone and help is available; explore reasons for living, strengths
  and past coping;
- agree next steps, and **follow up within hours and over the next days**.

**Be ready beforehand:** know your organisation's policy, know how to reach emergency
services, and keep a list of crisis lines.

**Passive thoughts with no plan, intent or history:** still validate ("you're brave to share
this"), ask directly, summarise, **tell your supervisor anyway**, say you'll ask again, and
agree what to do if things change.

### 5.8 Explanation, daily life, coping: the Understand trio
- **Explanation.** Find out what the *person* thinks causes the problem, and what family and
  friends think (contacting them *directly* needs permission). Aim for a **shared
  understanding**, because people disengage from help aimed at the wrong cause. **Never
  belittle** their view, even a superstitious one, and **never endorse** a harmful one. With a
  very harmful belief it's fine to be more direct, to link the problems together, or to
  normalise.
- **Daily life.** Problems ripple into relationships, work and self-care, and can spiral.
  **Don't criticise the impact or induce guilt.** Even when the cause can't be fixed, the
  impact can sometimes be eased, and understanding it sets up the work on coping.
- **Coping.** Positive coping includes self-care, exercise, supportive people and small steps.
  Negative coping includes alcohol, taking it out on others, risky behaviour and endless
  scrolling. Coping is individual. **Don't criticise and don't endorse the negative**;
  challenge gently, remembering that negative coping is often a best effort.
- A worked example (job loss, neck pain, mother blames coffee and too little prayer): the
  helper asks the person's view, then the mother's; **reflects the chain** (worry → poor sleep
  → pain → can't get up); finds where the two views overlap; helps plan a talk with the
  mother; asks about impact (irritable, gives up job-hunting, doom-scrolls); normalises the
  social-media comparison; finds positive coping (walks); and **substitutes** walking with a
  friend for scrolling.
- The unhelpful version: labelling ("anxiety and depression") before asking, siding with the
  mother, catastrophising, dismissing walks, "just stop worrying", jargon, stigma.

### 5.9 Family and trusted people
- Don't imply you're the only helper, or that they shouldn't tell anyone. People cope better
  when connected. A trusted person can be anyone reachable: a household member, relative,
  friend or neighbour.
- **Ask** whether there's someone they'd like to involve. If yes, offer to contact them, to
  contact them together, or to help rehearse. If no, **that's fine**.
- **The person decides, not the family.** The only exception is imminent risk, and then you go
  to the **supervisor first**, not the family.
- If a relative is already present, **first speak to the person alone** to confirm they're
  comfortable with it, and ask what they want shared.

### 5.10 Psychoeducation
- Explain symptoms, causes and helpful actions so the person can link feelings to recognised
  causes, make informed decisions and feel less stigmatised. The focus is *how to
  communicate*, not clinical content.
- **Build on their explanation.** Understand how they frame it first, then connect the
  education to that frame.
- Rules: no jargon unless you know it's understood; no stigmatising language; don't belittle
  their view; use local concepts **accurately**.
- Example: a friend's metaphor, "my **batteries are backwards**" (worry drains them at night,
  so they're empty by day). The unhelpful reply dismisses it ("people don't have batteries…
  chemical imbalance…"). The helpful reply **adopts the metaphor**, explains the mind–body
  link plainly, offers options (breathing, problem-solving, other programmes, medication), and
  asks whether they'd like to try.

### 5.11 Collaborative goals
- Goals sustain motivation, give a sense of control, show progress and **manage expectations**.
  Ask about their reasons and goals. Be honest about what's achievable (you can't give a job,
  but you can build skills toward one). They must understand and **agree**.
- Short-term goals help now ("see a counsellor next week"); a longer relationship needs a plan
  with a long-term goal and intermediate steps.
- Example: someone wants the gym every day. Praise the intent, suggest twice a week to start,
  make it specific (walk to work, join a class), agree to review, and ask **"Does that plan
  work for you?"**

### 5.12 Realistic hope
- Build hope for something **achievable**; unrealistic hope does damage. Be specific and link
  it to what they value ("keep walking and you'll enjoy playing with your grandchildren more").
- **Hope isn't optimism.** "I just know everything will get better" loses trust. Hope accepts
  uncertainty but expects some change through effort.
- Build it *together*. Notice hopelessness and remind them of skills they've gained, without
  dwelling on mistakes. **Don't criticise doubt.**
- A useful sequence: ask what gives them hope, then what takes it away (the opposite of what
  drains hope often builds it), praise the help-seeking, summarise, and plan how to do more of
  what builds hope.
- **Hopelessness that is not imminent risk** ("Nothing works", "What's the point?"): respond
  with empathy and encouragement ("Change doesn't come quickly, even when you try hard") and
  reflect on anything helpful so far, however small.

### 5.13 Eliciting feedback
- Keep checking that you've been understood and what they think ("How does that sound?"),
  **always after giving advice or suggestions.**
- If asked directly for advice, offer a few options and **immediately ask** which help.
- Respond by clarifying and reflecting; that builds trust. Unhelpful: not asking, ignoring or
  dismissing their answer, "I know best".

---

## 6. Attitude blockers: could help, should help, ready to help

Attitudes leak out as unhelpful behaviour: sounding annoyed, distracted or rushed. Think of
help as water in irrigation channels; each blocker leaves part of the field dry.

| Blocker | Typical thoughts | What clears it |
|---|---|---|
| **Can't help → could help** | "It's too big" (jobs, violence, severe illness, poverty) · "no time" · "no resources" | Set a realistic *private* goal ("give them space to talk and connect them to support") · agree achievable interim goals with them · **empathic listening is itself help** · know your referral routes in advance (which also makes asking about suicide easier) |
| **Shouldn't help → should help** | Blaming them (smoking, alcohol) · "they won't listen" · others will disapprove (stigma, sexuality, religion) · "they'll disrupt my work" · "it's someone else's job" | Remember why you became a helper and to be non-judgemental · you never know the whole story; **asking for help is the first sign of wanting change** · change the circumstances (a longer slot, a referral to share the load) · advocate for helping everyone · **don't over-identify**: the responsibility for change is theirs, and your role is space, time and tools |
| **Not ready → ready to help** | Your own anxiety, anger, tiredness, overwhelm | Name your own emotions before a session · manage stress actively (breathing, muscle relaxation) · share with colleagues while protecting confidentiality · **self-care isn't a luxury** (sleep, diet, exercise, meaning, family, faith) |

"Should help" covers everyone: any ethnicity, nationality, gender, health condition,
substance use, survivors of violence or abuse, poverty, disability, sexual orientation or
gender identity, refugee or legal status, political affiliation, and people who have committed
violence or crime.

A practice pair: the same case played twice, first with every blocker stacked (just had a
hostile client, public space, five minutes to a meeting, thinks the client is lazy), then with
each blocker removed (deep breaths, a private room, a supervisor who allows extra time,
listening even though you can't solve the problem, referring onward). Stress exercises should
never *require* closed eyes.

---

## 7. Practice and assessment role-plays

These make good AI roleplay seeds, and show what makes each skill observable.

**Skill-focused practice prompts** (the client's opening line):

| Skills | Client prompt |
|---|---|
| verbal (and non-verbal) | A mildly stressful event from the past week; the helper opens with "How was your past week?" |
| rapport, confidentiality | A first meeting, the client unintroduced: "I'm worried you'll tell my family…" |
| empathy, feelings | "My son just finished school; I lie awake worrying he won't find a job; I'm tired every morning." |
| harm | "Some nights I wish I wouldn't wake up" / "My family would be better off without me." |
| explanation, functioning, coping | Lost a job, poor sleep, worry. "Lost my job… or maybe I'm cursed." Family say "weak and lazy". Forgetful (too much salt, repeats questions). Copes with gardening and one task a day, but also junk food and scrolling. |
| family | "My sister wants to know how to help" / "She always asks what we talk about." |
| psychoeducation | "What do you call it?" The client answers: "my personal cloud since I lost my job." |
| goals, hope, feedback | Asks the helper to "get me a job / fix everything". If refused: "Then this is hopeless." Once steered: "worry less and plan my search". If a goal is imposed: "I don't think I can do that." |

**The full assessment role-play** covers all skills in about 10 minutes, one-to-one with no
audience, followed by scoring and about 5 minutes of feedback (strengths → unhelpful
behaviours with reflection → positive close).
- Helper brief: *"You support people in distress. This person was referred by a community
  outreach programme. It's a first meeting and you have no other information. You have about
  10 minutes to understand their distress and engage supportively."*
- Hidden client background: 34 years old, with a partner at home and two sons (6 and 12).
  Moved from a rural area to a city. Service-job hours are being cut and they are the sole
  earner. Tired, sluggish, sleeping badly, in pain all over, struggling to get up for shifts.
  **No suicidal thoughts.** Hasn't told their partner about the hours. Feels guilt and shame
  ("failing my family"), alone, can't concentrate. Fears homelessness and fears the partner
  will leave. The younger son cries more; the older one hits the partner, breaks things,
  fights and stays out late. Used to enjoy morning walks and weekend friends, and now thinks
  the friends don't want them around.
- Prompts by skill:

| Skill | Client prompt | What it tests |
|---|---|---|
| non-verbal, empathy | Distressed body language, quiet voice | An empathic response |
| verbal | Short answers to closed questions, detail to open ones | Whether the helper switches to open questions |
| confidentiality | "Are you going to tell anyone these things?" | Quality of the explanation |
| rapport | "The community health worker said I could come to you"; no name unless asked | Introduction, putting them at ease |
| feelings | Share feelings only if asked | Whether the helper asks |
| harm | "It feels like the world is falling to pieces. Some nights I don't want to wake up." If asked: "No, I want to stay alive for my family." Past attempts: "Never." | Whether the helper asks directly |
| functioning | "I feel like a failure" / "No energy; my friends wouldn't want to see me like this" | Exploring impact |
| explanation | "Money worries… or maybe I'm cursed." Brother thinks "lazy" | Handling differing or harmful views |
| family | Close people: partner and son. Wants involved: an aunt or neighbour | Respecting the choice |
| goals | "I want a full-time job", then (if steered) "worry less, feel confident finding work" | Reframing, suggesting steps |
| hope | "Will meeting you fix everything / get me a job?" "If not, this is hopeless" | Realistic hope |
| coping | Positive: walks, friends. Negative: "I yell at my son" | Encouraging good coping, reframing bad |
| psychoeducation | On any jargon: "What does that mean?" | A plain-language explanation |
| feedback | "Some are helpful, some seem too hard for me", then ask for other options | Adapting to feedback |

---

## 8. The passive measure (`src/foundational-skills`)

**Goal:** show whether learners get better at the common denominator, whatever scenarios and
courses they practise. It is deliberately independent of every scenario's own competencies.

**Pipeline** (`FoundationalSkillsService`, on the scheduler's `30min` bucket; switch it off
with `FOUNDATIONAL_SKILLS_SCHEDULE=off`):
1. **Eligible sessions**: `scenario_sessions` that are `ENDED` + `COMPLETED`, ended at least
   60 minutes ago (late turns and timestamp rewrites land after the end signal), countable
   (no preview or seed rooms), not an AI-vs-AI test (`metadata.v2vTest`), and not in a test
   org.
2. **Turns**: `scenario_session_messages` in spoken order (`COALESCE("startSeconds",0), id`).
   `senderId = -1` is the character and anything else is the learner. Fillers and interim
   replies (`metadata.utteranceKind`), empty lines and exact consecutive repeats are dropped.
3. **Cuts** (`foundational_skill_cuts`): each learner's sessions, **in the order they ended**,
   are read as one stream. A cut closes on the helper turn that brings the **learner's own
   speech** to 5,000 characters (code points), so turns are never split. Cuts may span
   sessions. They are **append-only** and independent of the rubric version. Learner speech is
   the clock because character verbosity varies about 10× across sessions.
4. **Rendering**: a cut that starts mid-session gets up to 2,000 characters of **unscored
   context** from earlier in that session. Scored lines get ids (`H4`, `C4`), and sessions are
   bracketed with whether their opening and end fall inside the window.
5. **Judge** (`FoundationalSkillsJudgeService`, AI task `foundational-skills-judge`, model
   pinned in `FHS_JUDGE_MODEL`, never falls back): for each of the 14 skills the judge decides
   opportunity, then ticks behaviour codes, each with a line id and a verbatim quote. It never
   assigns levels.
6. **Validation** (`validateJudgement`): a tick survives only if the code belongs to the skill,
   the line is in the scored window, the speaker is right (helper; client for absence
   behaviours), and the quote occurs in that line. Dropped ticks are counted. A reply that
   omits any skill is a **failed attempt** (retried hourly, up to 3 times), never a partial
   score, because an omitted skill would otherwise read as "no opportunity".
7. **Levels and composite**: `deriveLevel` per skill, and the composite is the mean of the
   assessed skills. Results go to `foundational_skill_assessments`, keyed `(cutId,
   rubricVersion)`. Only behaviour codes are stored, never quotes.
8. **Read side**: `GET /v1/analytics/foundational-skills` returns, per cut, the learners who
   reached it, their average, **the same learners' average at cut 1** and their paired change
   (the control for survivorship: later cuts hold only people who kept practising; computed
   over learners with a scored cut 1, alongside that same paired set's cut-k average), the share
   showing an unhelpful behaviour, and per-skill averages. Averages are withheld below 20
   learners (`MIN_SCORE_SAMPLE_SIZE`), and the axis ends at the last cut reached by at least
   5. The chart is **AAQ-166** on Highlights → Priority.

**Second consumer — text-helpline QA** (`src/helpline/service/helpline-qa.service.ts`, contract
`docs/text-helpline.md` §10): an ended helpline chat is rendered as one whole session (the listener of
record's typed messages as HELPER, the talker's as CLIENT) and scored by
`FoundationalSkillsJudgeService.judgeHelpline` — the same rubric, validation, level rule and pinned model,
under its own task (`helpline-qa-judge`). Only the prompt's opening differs: it says the transcript is a
real, typed chat with a person seeking support, not speech-to-text roleplay with an AI client (the
roleplay prompt is byte-for-byte unchanged, which a spec pins). Its scores carry their own version,
`FHS_RUBRIC_VERSION + '+helpline-chat-v1'`, and are never averaged with the measure's.

**Changing the ruler:** any edit to the rubric, the prompt or the model means bumping
`FHS_RUBRIC_VERSION`. Every cut is then re-scored under the new version, and scores from two
versions are never averaged together.

**Known limits:** characters per word differ by script, so compare within a learner rather
than across languages. Scenario mix changes which skills get an opportunity (hence
opportunity gating). With about 90 active learners, only the first few cuts clear the n=20
floor.

**Built on the measure (2026-10, `docs/effectiveness-analytics-plan.md` §13):**
- **Feedback → skill mapping** (`FeedbackSkillMappingService`, AI task
  `feedback-improvement-skill-mapping`, off unless `FEEDBACK_SKILL_MAPPING_SCHEDULE=on`): files
  each "area of growth" in a session debrief under one rubric skill or none, so
  `GET /v1/analytics/foundational-skills/feedback-uptake` (AAQ-221) can ask whether a named skill
  then moved, against the same learner's unnamed skills. Stores skill keys and positions, never
  the improvement text.
- **Self-efficacy instrument** (`learner_self_assessments`, `GET`/`POST /v1/self-assessment`):
  one 0–10 confidence item per rubric skill, asked at onboarding, every 3 scored cuts and on
  course completion. Always read beside the judge (AAQ-230/231), never alone — learners are poor,
  often over-confident self-assessors. No learner-facing prompt ships yet.
- **Human ratings of the judge** (`fhs_human_ratings`): people tick behaviour codes on a
  quarterly 30-cut sample stratified by composite tercile × language
  (`GET /v1/foundational-skills/human-ratings/sample`); levels are derived with `deriveLevel`,
  never entered. `GET /v1/analytics/foundational-skills/judge-agreement` (AAQ-223) reports
  Cohen's κ judge-vs-human and human-vs-human. No rating UI ships yet.

---

## 9. Mapping to the rest of the codebase

This is a snapshot from 2026-09-30. **Re-check with grep before relying on it.**

**Roleplay competencies** (per-scenario scoring, *not* this measure):
- Seed migration: `src/database/migrations/1772180836979-insertCompetenciesAndBehaviors.ts`
  (15 names plus behaviours).
- Presets: `src/learn/constants/competency-behavior-instruction-templates.constants.ts`
  (`COMPETENCY_BEHAVIOR_INSTRUCTION_PRESETS`, tagged `SHOULD_DO | SHOULD_NOT_DO`).
- In the admin UI, a competency cluster groups these 15 under one label in the competency
  picker (`ally-web/.../components/competency/Competency.tsx`).

| Rubric key | Seeded competency name | Match |
|---|---|---|
| non-verbal | Non-Verbal Communication | ✔ but voice-adapted (tone, pitch, pacing replace eye contact and posture) |
| verbal | Verbal Communication | ✔ (+ "overuse of *why* questions", "premature advice") |
| confidentiality | Explain & Promote Confidentiality | ✔ (limits also include harm *from* others) |
| rapport | Rapport Building & Self-Disclosure | ✔ (+ "rushes clients", "over-shares") |
| feelings | Exploration & Normalization of Feelings | ✔ |
| empathy | Empathy, Warmth & Genuineness | ✔ |
| harm | Assessment of Harm & Response Planning | ✔ (+ "leaves client alone" as a don't) |
| functioning | **Linking Emotions, Thoughts & Behaviours** | ⚠ **Different skill.** Adds a cognitive-behavioural framing; the daily-functioning items overlap |
| explanation | Explore Client's Explanation for Problem | ✔ |
| family | Involvement of Family & Significant Others | ✔ |
| goals | Collaborative Goal Setting | ✔ |
| hope | Promote Realistic Hope | ✔ |
| coping | Strengthen Coping Strategies | ✔ (+ "judges past problem-solving attempts") |
| psychoeducation | Psychoeducation with Local Terminology | ✔ |
| feedback | Elicitation of Feedback | ✔ |

**Structural differences:** the seeded competencies merge basic and advanced into
`SHOULD_DO`, so levels 3 and 4 can't be derived from them. The "any `SHOULD_NOT_DO` → 1" rule
can. Per-scenario scores (`scenario_sessions.score`) and the judge composite are separate
numbers again. The Skill growth sub-tab (AAQ-042…) charts the per-roleplay judge composite by
session number; this measure is the scenario-independent counterpart.

**Course impact** (Highlights → Course impact, AAQ-193…197, `GET /v1/analytics/course-impact`)
reads this measure per course: each learner's last 3 scored cuts before starting a course
against their first 3 made wholly after finishing it. To mark which skills a course teaches it
maps its roleplays' competencies onto rubric keys by the exact names in the table above
(`src/analytics/constants/course-impact.constants.ts`), leaving out Non-Verbal Communication
(not scored from text) and Linking Emotions, Thoughts & Behaviours (a different skill from
`functioning`). Renaming a seeded competency silently drops it from that map.

---

## 10. Design principles for features built on this

1. **Score behaviours, derive levels.** An LLM should tick behaviours with evidence;
   deterministic code applies §3.1. Asking a model for "a level" hides the reasons and
   under-applies the level-1 rule.
2. **Unhelpful behaviours are first-class.** Report them prominently; one harmful act
   outweighs many good ones.
3. **"Didn't ask" is a harm for `harm` and `functioning`,** so the scenario has to create the
   opening, or absence is ambiguous.
4. **Feedback copy follows §3.2**: strengths → specific improvement with a practice suggestion
   → positive close. Aggregates across learners report trends and respect small-group floors.
5. **No pass/fail language** in learner-facing copy.
6. **Simulated clients should follow §4's client instructions and §7's prompts.** Withholding
   the name and feelings until asked, and pushing back on feedback, are what make behaviours
   observable.
7. **Only score what the situation elicited.**
8. **Tentative, validating language is the gold standard** ("I wonder if…", "It sounds
   like…", "Have I understood…?"). Never "I know how you feel". This applies to AI-coach tone
   too.
9. **Culture is a parameter**: what counts as appropriate contact, eye contact or language,
   and which local concepts psychoeducation should use.
10. Label levels as a **score, 1–4**, never "L1–L4" (only XP levels use L-names).

---

## 11. Glossary

- **Foundational helping skills (FHS)**: the 15 behaviours above.
- **Level / score (1–4)**: derived from ticked behaviours by §3.1.
- **Opportunity**: whether the situation called for a skill at all; no opportunity means not
  assessed.
- **Absence behaviour**: an unhelpful behaviour defined by *not* doing something after a clear
  cue.
- **Conditional basic**: a basic behaviour that reacts to something only the client can
  supply.
- **Cut**: 5,000 characters of one learner's own roleplay speech, the unit the passive measure
  scores.
- **Explanatory model**: the person's (and their network's) own account of what causes their
  problem.
- **Validation / normalisation**: acknowledging a feeling / reassuring that it's a common,
  understandable reaction.
- **Psychoeducation**: plain-language education about symptoms, causes and helpful actions.
- **Imminent risk**: someone may be about to take their life (criteria in §5.7).
- **Could / should / ready to help**: the three attitude blockers (§6).
