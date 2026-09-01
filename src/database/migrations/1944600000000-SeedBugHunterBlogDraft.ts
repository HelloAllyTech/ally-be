import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the "Meet Bug Hunter" explainer post into `blogs` as a DRAFT.
 *
 * ## Why a migration and not the admin UI
 *
 * The post is ~18KB of hand-checked HTML. Pasting that through the rich-text
 * editor risks the editor rewriting the markup on the way in, and it would have
 * to be redone by hand in every environment. Seeding it is reviewable in a PR
 * and lands identically everywhere. Same idempotent-insert pattern as
 * 1913000000000-SeedBugHunterAgentRoadmapOwner and 1871000000002-SeedProductRoadmapTaxonomy.
 *
 * ## Why the body is already sanitizer-shaped
 *
 * A raw INSERT bypasses `sanitizeBlogHtml`, which the service applies on every
 * write. So the body below was authored inside that util's allowlist to begin
 * with — p / strong / em / h2 / h3 / ul / ol / li / blockquote / hr only, and no
 * attributes at all. Nothing here would be stripped if it went through the
 * service, which means editing this post in the admin later cannot silently
 * change how it renders.
 *
 * ## This migration delivers the post; it does not own it
 *
 * A merged migration is immutable, and article copy gets edited. That is fine
 * because the row is an ordinary blog post the moment it exists: every later
 * change goes through `PATCH /v1/blog/:id` in the admin like any other post.
 * Nobody should ever come back here to fix a typo.
 *
 * DRAFT deliberately, and `published_at` stays NULL — the public listing filters
 * on PUBLISHED, so this is invisible outside the admin until a human presses
 * Publish.
 */
const SLUG = 'bug-hunter-night-shift';

const TITLE = 'Meet Bug Hunter, the engineer who works while everyone sleeps';

const TLDR =
  'Every night an agent called Bug Hunter sweeps five of our codebases, finds ' +
  'what is broken, tries to prove itself wrong, fixes what it is safely allowed ' +
  'to, and leaves a written account for the morning. What it does, what it is ' +
  'structurally forbidden from doing, and why it matters on a platform used ' +
  'mid-crisis-call.';

const CATEGORY = 'Engineering';

/**
 * Free-form display byline, distinct from `created_by` (the user row credited
 * with authoring the record). A team name rather than a person's, because the
 * post describes a platform capability rather than one engineer's work.
 */
const AUTHOR_NAME = 'Ally Engineering';

const TAGS = ['engineering', 'bug-hunter', 'ai-agents', 'quality'];

const BODY = `
<h2>A night caretaker for the code</h2>

<p>Picture the night caretaker in a large building. Everyone goes home at six. At two in the morning someone walks the corridors: tries the doors, tests the smoke alarms, reads the complaints book at the front desk, changes a dead bulb, and writes every one of those things down in a logbook. In the morning the building manager reads the logbook — not the corridors.</p>

<p>Bug Hunter is that caretaker for Ally's software. It clocks on at around a quarter past two in the morning, works through five separate codebases — the backend, the web dashboards, the AI service, its learning counterpart, and the mobile app — and by the time the team is at their desks there is a written account of what it found, what it fixed, and what it needs a human to decide. Each codebase gets its own slot, twenty minutes apart, so five sweeps never land in the same minute.</p>

<p>The part that makes it new is not the walking around; automated checks have done that for twenty years. It is that this caretaker <strong>reads</strong>. It forms a view about whether something is actually wrong, argues itself out of the wrong conclusions, writes the repair <em>and</em> the proof that the repair worked, and then hands it to a person to approve. A script can follow a checklist. Judgement is the thing being added.</p>

<blockquote><p><strong>Under the hood:</strong> it is Claude Code, running unattended on a disposable machine inside our build system. The instructions it follows are not stored in the five codebases — they are served from the backend at the moment it starts. That means all five always run the same, current protocol, and improving how it works takes effect on the next night's run rather than after five separate code changes.</p></blockquote>

<hr>

<h2>A night in the life: four phases, in this order, every time</h2>

<h3>02:15 — Clocking on</h3>

<p>The very first thing it does is ask whether it is on duty at all. If the switch is off, it records "asked, not permitted" and stops. Nothing about this agent starts by accident, and a request made while it is off duty still leaves a trace, so the history stays honest.</p>

<h3>02:16 — Phase one: four separate looks</h3>

<p>It checks for bugs four different ways. These are genuinely different instruments, not one search repeated:</p>

<ul>
<li><strong>The smoke-alarm test.</strong> It runs the entire automated test suite and the style checker. No judgement is needed here: a failing test <em>is</em> a bug. The alarm either sounds or it doesn't.</li>
<li><strong>Fresh eyes on yesterday.</strong> It reads only the work that changed in the last day, looking for the kind of mistake a careful reviewer would catch. Bounded on purpose — there is a "deep" mode that reads the whole codebase, but it costs a great deal more, so a human opts into that one sweep at a time.</li>
<li><strong>The complaints book.</strong> The last 24 hours of real errors from the live service. Only distinct, recurring ones count; a single transient blip is noise, not a defect.</li>
<li><strong>The suggestion box.</strong> Bugs that actual people filed — staff and, since we opened it up, the counsellors and health workers using the product. It takes the ones clearly about the codebase it is standing in and leaves the rest.</li>
</ul>

<p>Every one of the four reports back <em>even when it found nothing</em>. A clean check is a result. A silent check is indistinguishable from a check that never ran, and that distinction is the whole value of a logbook.</p>

<h3>02:40 — Phase two: try to prove itself wrong</h3>

<p>This is the phase people are surprised by. For anything it merely <em>suspects</em>, it makes three independent attempts to knock its own finding down, reading the real code fresh each time. If two of the three succeed, the finding is dismissed. And the default, if it is not confident, is dismissal.</p>

<p>Think of an editor who won't print a story until the reporter has survived three attempts to demolish it — and spikes it when in doubt. The reasoning is an asymmetry: a false alarm costs a busy engineer an hour reading code that was fine, and erodes trust in everything else on the list. A genuinely missed bug costs one more night. So the machine is tuned to under-report.</p>

<h3>03:05 — Phase three: fix, in a strict order</h3>

<ol>
<li><strong>Write the test that fails <em>because</em> of the bug.</strong> Photograph the leak before you touch the tap. If it cannot make a test fail, then the bug does not reproduce — and it says exactly that and drops it. This one rule prevents most of what could go wrong.</li>
<li><strong>Make the smallest change that fixes it.</strong> No tidying up while it's in there, no renaming, no "while I'm here".</li>
<li><strong>Everything green.</strong> The new test passes and every existing test still passes. It is never permitted to make a red suite look green by disabling a test.</li>
<li><strong>Two attempts, not five.</strong> If it can't get there in two, it stops and writes down precisely what it tried and what it saw. Stubbornness is expensive.</li>
<li><strong>Open it as a proposal for a human to read.</strong></li>
</ol>

<p>Hard bugs get escalated. For a genuinely difficult root cause, or anything close to a sensitive area, it pages in a stronger and considerably more expensive model for <em>that one bug</em>, then goes straight back to the cheaper one. Like a duty nurse calling the consultant — for one patient, not for the whole shift.</p>

<h3>03:50 — Phase four: close the book</h3>

<p>Exactly one closing entry, whatever happened, including "found nothing". If it stops without closing, the build itself goes red and someone is told, because a run left open would look to an admin like a sweep that is still working. There is no quiet failure available to it.</p>

<hr>

<h2>Three settings, not an on/off switch</h2>

<ul>
<li><strong>Off</strong> — the default. It does nothing at all. This is how it ships, and every single path through the system checks this setting before anything else happens.</li>
<li><strong>Manual</strong> — it finds, proves and records, then stops and waits for a person to say which bugs it may work on.</li>
<li><strong>AI</strong> — it finds, proves, records <em>and</em> repairs, within the limits below.</li>
</ul>

<p>Two details in there matter more than they look. First, <strong>discovery is identical in Manual and AI.</strong> Even when it is not allowed to touch anything, it keeps building the list every night, because knowing what is wrong has value on its own and a register that only fills up when repairs are switched on is a worse register.</p>

<p>Second, <strong>approval, once given, does not evaporate.</strong> If someone approves a fix on Monday and the setting drops back to Manual on Tuesday, that approved fix still gets done. A permission granted by a human should not be quietly revoked by a switch.</p>

<hr>

<h2>What it may do, and what it may never do</h2>

<h3>It may</h3>

<ul>
<li>Open a fix as a proposal for a human to review.</li>
<li>Approve up to three genuinely trivial fixes a night on its own.</li>
<li>Fix a bug an admin asked for by name, and merge it once green.</li>
<li>Record a bug in a codebase it has no way to repair.</li>
<li>Ask a question and move on to the next bug.</li>
<li>Update a document its fix made out of date.</li>
</ul>

<h3>It may never</h3>

<ul>
<li>Deploy anything to production. That stays a human click, always.</li>
<li>Touch security, permissions, payments or the database's structure unsupervised — however small the change.</li>
<li>Approve its own work in the mobile app, ever — not even a one-line fix.</li>
<li>Skip, disable or quarantine a test to make the checks pass.</li>
<li>Invent an answer to a question about how the product is supposed to behave.</li>
<li>Refactor, rename or tidy anything it wasn't sent in to fix.</li>
</ul>

<p>The mobile rule is worth a sentence, because it looks inconsistent until you see why. Our automated checks run on a server, and a server cannot tell you how an app behaves on a real phone — nor whether the Malayalam text renders at all on a particular Android handset. And once a version reaches the app stores, health workers stay on it for months. You cannot sign off a car's brakes from a photograph of the car.</p>

<p>The three-a-night cap is the clearest statement of the whole philosophy. <strong>Nobody asked for these fixes.</strong> It went looking. Because nobody asked, most of what it finds stays a proposal for a person to accept or decline — and it is explicitly told not to approve something borderline just because it was permitted to. A proposal costs a reviewer five minutes. A bad merge costs considerably more than that.</p>

<p>The exception is a fix a person specifically requested. There, an admin has named the bug, so a green, tested fix merges. The asymmetry is intentional: how much latitude it gets depends on whether a human asked.</p>

<hr>

<h2>What happens when it doesn't know</h2>

<p>Some bugs aren't coding mistakes. They're places where nobody ever decided what the software should do — what should this screen show when there's no data yet? Should this limit be five or fifty? Bug Hunter does not guess at those. It writes the question down, marks the bug as waiting on a person, and moves to the next one.</p>

<p>On a fix somebody just requested, it waits about twenty minutes for an answer — that person is probably still watching the screen. On a night sweep it doesn't wait at all; it has other work to do, and it will read whatever was answered on the next run.</p>

<p>Because a question asked at two in the morning could otherwise sit unread forever, there is a backstop: anything unanswered for more than <strong>four hours</strong> produces one summary message — one, covering everything that is waiting, <strong>at most once a day</strong>. Not one per bug, and not hourly. The tuning is deliberate: four hours catches neglect rather than impatience, and a notice that repeats every hour becomes wallpaper.</p>

<hr>

<h2>Why this agent is critical, not merely clever</h2>

<p>Four numbers frame the rest of this section:</p>

<ul>
<li><strong>5</strong> codebases swept in full, every night.</li>
<li><strong>4</strong> independent checks per sweep, each reporting even when clean.</li>
<li><strong>3</strong> trivial fixes it may approve itself per run — the hard ceiling.</li>
<li><strong>0</strong> production deployments it is able to make.</li>
</ul>

<h3>On this platform, a bug isn't an inconvenience</h3>

<p>Ally is used by counsellors and community health workers, often on a modest phone, often while someone is on the other end of a difficult conversation. When something breaks, a session's notes don't save, or a screen stalls mid-call, or a health worker in a village can't log in because the app version in her hand was stricter about something than the server now is — which has actually happened to us. A bug caught at two in the morning on the night it was introduced, and the same bug found six weeks later by a health worker mid-session, are the same defect at wildly different prices. Bug Hunter exists to move as many bugs as possible from the second column to the first.</p>

<h3>It does the work that will never win an argument</h3>

<p>Every engineering team carries a backlog of small, real, unglamorous defects that never beat a feature in a planning meeting. They don't get fixed because each one, on its own, isn't worth the meeting — and so they accumulate, and eventually they are the reason a product feels fragile. Bug Hunter's economics are simply different. It doesn't need to win the argument. It works at 2am, in parallel, and the marginal cost of it reading one more file is cents. It is aimed precisely at the class of problem a human team is rationally correct to keep postponing.</p>

<h3>A reported bug becomes work the same night</h3>

<p>One of the four checks reads the bugs people actually filed. That closes a loop that is broken almost everywhere: a bug someone reports on Tuesday afternoon is picked up on Tuesday night, proven or dismissed, and often already has a proposed fix attached to it by Wednesday morning — before anyone has held a triage meeting about it. Reporting a bug stops feeling like posting into a void, which is the thing that determines whether people bother to report the next one.</p>

<h3>It scales with the code, not the headcount</h3>

<p>Five codebases, every night, in full, with identical rigour applied to each. A human team has to choose where to look, and chooses reasonably — whatever shipped most recently, whatever someone shouted about. Bug Hunter doesn't choose. Adding a sixth codebase is one line of configuration, not a hire. This is the property that makes it strategic rather than a nice tool: our surface area will keep growing, and this is the only part of quality assurance that grows with it for free.</p>

<h3>The safety is structural, not a promise</h3>

<p>This is the argument that should matter most to anyone uneasy about an AI writing production code. It is off by default. It cannot deploy. It cannot touch anything security-sensitive without supervision. It can approve at most three trivial things a night. It must prove a bug with a failing test <em>before</em> it is allowed to fix it. It gets two attempts and then stops. It can never make a failing check pass by disabling the check. None of these are things it undertakes to do — they are limits built into the instructions it is given and the system it reports into. The realistic worst case of a bad night is a handful of proposals a human declines, and a few dollars spent.</p>

<h3>Every night is costed to the cent</h3>

<p>Each run records what it spent, itemised, against the run that spent it — and each night's ledger sits next to what it bought: bugs found, fixes proposed, fixes merged, false alarms dismissed. Very few engineering investments arrive with that ledger attached. It also means the decision to keep it on is a decision you can re-examine monthly with numbers, rather than a matter of faith. Worth noting on the honesty front: the cost figure used to under-report, because one category of usage wasn't being priced. That was found and corrected.</p>

<h3>It builds a register the team never had</h3>

<p>Every bug it has ever seen is one row, carrying its whole history — who reported it, what proved it real, which attempt fixed it, when it shipped. Crucially, the same bug found again on a later night attaches to the <em>existing</em> record instead of opening a new one, so the list stays a list of problems rather than a list of sightings. Getting that right took a deliberate fix: an early version identified bugs partly by the wording of its own description, and since the wording changed each night, the same bug kept opening fresh records — it was manufacturing its own noise. That register, honestly maintained, is arguably worth as much as the repairs.</p>

<hr>

<h2>It is presented as a colleague, on purpose</h2>

<p>Open the Bug Hunter screen in the admin console and you don't see a pipeline. You see something closer to a profile card: a status line written in the first person, an inbox of things it has said to you, the queue of bugs waiting on your decision, a live board of what it is doing this minute, and a scorecard of what it has cost and what that bought.</p>

<p>That framing is a product decision, not decoration. An admin who reads <em>"I'm stuck on this one, here's the question"</em> acts on it. The identical fact rendered as a row in an events table gets scrolled past.</p>

<p>It has rules about how it speaks, and they are written down: first person, because it is the one speaking; plain and calm, with no jokes and no exclamation marks, because a chirpy tone next to a failed release is wrong; it never claims work it hasn't done (a dispatched release is "running", not "released", because the outcome lands minutes later); and every message ends with what happens next, because a status with no next action is a dead end.</p>

<p>It also has exactly <em>one</em> way to reach you: that inbox. It used to post to Slack as well, and that was deliberately removed. An agent with a megaphone stops being read.</p>

<hr>

<h2>What it is not</h2>

<ul>
<li><strong>It does not understand the product.</strong> It understands code. Anything that is really a product decision comes back to a person as a question — which is the correct behaviour, but it means it cannot tell you that a feature is confusing, only that a function is wrong.</li>
<li><strong>A routine night only looks at recent work.</strong> The nightly review reads what changed in the last day. A subtle bug that has been sitting quietly for two years will not be found by a routine sweep. There is a deep mode that reads everything, opted into one sweep at a time, and it costs a great deal more.</li>
<li><strong>It cannot verify what a machine cannot run.</strong> How the app behaves on a real handset, whether a layout looks right, whether a journey feels sensible — all outside its reach. This is exactly why the mobile app is look-and-report only.</li>
<li><strong>It is only as good as our tests.</strong> The strongest of its four instruments is the automated test suite. A weakly tested area of the code gives it a weak instrument, and investment in tests raises its ceiling directly.</li>
<li><strong>It is not a replacement for human review.</strong> Nearly everything it does ends up in front of an engineer. The value is not that review disappears — it's that a reviewer opens a written, evidenced, tested fix instead of starting from "something seems off, can you look".</li>
</ul>

<hr>

<p>Bug Hunter is not an engineer replacement, and it is not a robot doing tricks. It is the difference between a codebase that gets looked at when somebody has time, and one that gets looked at every single night — with the results written down either way.</p>
`.trim();

/**
 * `blogs.created_by` / `updated_by` are `integer NOT NULL` with no FK to
 * `users` (see 1829000000000-CreateBlogTable), so any number would satisfy the
 * schema — which is exactly why this resolves a real one instead. The admin list
 * renders the authoring user, and a hardcoded id means a different person in
 * every environment.
 *
 * Preference order is the platform's own admin tiering: SUPER_DUPER_ADMIN, then
 * SUPER_ADMIN (its subset), then the lowest user id as a last resort. Returns
 * null on an empty `users` table — a fresh local database, where seeding a post
 * credited to a user who does not exist is worse than not seeding one.
 */
async function resolveAuthorUserId(
  queryRunner: QueryRunner,
): Promise<number | null> {
  for (const groupName of ['SUPER_DUPER_ADMIN', 'SUPER_ADMIN']) {
    const rows = await queryRunner.query(
      `SELECT ug."userId" AS "userId"
         FROM user_groups ug
         JOIN "groups" g ON g.id = ug."groupId"
        WHERE g.name = $1
        ORDER BY ug."userId" ASC
        LIMIT 1`,
      [groupName],
    );
    const userId = rows?.[0]?.userId;
    if (userId) return Number(userId);
  }

  const fallback = await queryRunner.query(
    `SELECT id FROM users ORDER BY id ASC LIMIT 1`,
  );
  const fallbackId = fallback?.[0]?.id;
  return fallbackId ? Number(fallbackId) : null;
}

export class SeedBugHunterBlogDraft1944600000000 implements MigrationInterface {
  name = 'SeedBugHunterBlogDraft1944600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const authorUserId = await resolveAuthorUserId(queryRunner);
    if (!authorUserId) return;

    // Guarded rather than ON CONFLICT: `uq_blogs_slug_idx` is a PARTIAL unique
    // index (live rows only), and a NOT EXISTS on the same predicate says what
    // is being checked without depending on Postgres inferring the index from a
    // repeated WHERE clause. Re-running this migration, or running it after
    // someone has already created the post by hand, is a no-op either way.
    //
    // Every parameter is cast explicitly. In an INSERT ... SELECT Postgres will
    // usually infer a parameter's type from the target column, but it is not
    // obliged to when the SELECT has no FROM, and "could not determine data type
    // of parameter" would fail the deploy rather than this file.
    await queryRunner.query(
      `INSERT INTO "blogs" (
         "title", "slug", "tldr", "body", "tags", "category",
         "author_name", "status", "created_by", "updated_by"
       )
       SELECT $1::varchar, $2::varchar, $3::text, $4::text, $5::jsonb,
              $6::varchar, $7::varchar, 'DRAFT', $8::int, $8::int
        WHERE NOT EXISTS (
          SELECT 1 FROM "blogs"
           WHERE "slug" = $2 AND "deletedAt" IS NULL
        )`,
      [
        TITLE,
        SLUG,
        TLDR,
        BODY,
        JSON.stringify(TAGS),
        CATEGORY,
        AUTHOR_NAME,
        authorUserId,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only while still an untouched draft. Once someone has published this post
    // it is their content, and a rollback of an unrelated later migration must
    // not delete it. A hard delete rather than a soft one so `up` can seed it
    // again cleanly — the partial unique index ignores soft-deleted rows, but
    // leaving a tombstone behind would be a confusing artefact of a rollback.
    await queryRunner.query(
      `DELETE FROM "blogs"
        WHERE "slug" = $1
          AND "status" = 'DRAFT'
          AND "published_at" IS NULL`,
      [SLUG],
    );
  }
}
