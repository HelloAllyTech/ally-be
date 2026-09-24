# Course discussions

Inline discussion threads attached to individual Track 2.0 course items
(`track_items`). A course author ticks **Enable discussion** on an item; learners
who can open that item can then read, post and reply beneath it, on web and
mobile.

Code: `src/course-discussion/`. Tables: `course_discussions`,
`course_discussion_posts`, plus `track_items.hasDiscussion`.

## Decisions that are not obvious from the PRD

- **Discussions are tenant-isolated.** Courses are global and assigned to many
  organisations, but a counsellor's reflections are shared with their own
  organisation only. There is one `course_discussions` row per
  `(trackItemId, tenant_id)`, created lazily on the first post or lock.
- **"Course creator" = holds `edit:admin:track`.** That is the permission that
  lets someone author a course, and it is what the PRD's moderation powers
  (edit any, delete any, lock) are gated on. Moderators do not need to be
  enrolled. Because they author courses used by many organisations, they can
  read and moderate any organisation's thread by passing `?tenantId=` (the admin
  console's moderation panel does this). Posting and replying always happen in
  the caller's own organisation.
- **Learners must be able to open the item** — enrolled, and the item not
  LOCKED — the same gate every other learner item route uses
  (`TrackEnrollmentService.getPermittedItemProgress`). Nobody has to post
  before they can read (R1).
- **Two locks.** A moderator can lock a single thread (a top-level post: no
  more replies under it) or the whole item's discussion (no new posts or
  replies anywhere). Learners cannot edit in a locked thread or discussion;
  moderators still can.
- **Depth is capped at 3** (post → reply → reply). The server rejects a reply
  to a depth-3 post; clients hide the Reply button there.
- **Learner edits close 15 minutes after posting.** Moderators can always edit;
  an edit by someone other than the author is flagged `editedByModerator` so
  the UI can say so.
- **Deletes.** A moderator delete removes the post and its whole subtree (R4).
  An author deleting a post that still has live replies leaves a
  `[deleted by author]` placeholder so the replies keep their context (R8);
  one with no replies is removed outright, and removing the last reply under a
  placeholder removes the placeholder too. Rows are soft-deleted.
- **Turning discussion off hides, not deletes.** Posts survive in the database
  and reappear if the author re-enables it.
- **Plain text, 1–4000 characters.** Stored and returned verbatim; clients
  render it as text (`white-space: pre-wrap`), never as HTML.
- **No XP or rewards for posting.** Track 2.0 is deliberately free of XP, and
  paying for posts invites low-effort ones.
- **Reply notifications** go to the parent post's author only (not the whole
  chain), never for replying to yourself, and not to the author of a deleted
  placeholder. In-app feed only, type `COURSE_DISCUSSION_REPLY`. A notification
  failure never fails the reply.

## API

All routes need a JWT. Learner routes take `view:track` (read) or `edit:track`
(write); every route also accepts `edit:admin:track` (moderator).

| Method | Path | Body | Who |
|---|---|---|---|
| GET | `/v1/learn/track-items/:itemId/discussion?tenantId=` | — | learner, moderator (`tenantId` honoured for moderators only) |
| POST | `/v1/learn/track-items/:itemId/discussion/posts` | `{ content }` | learner, moderator |
| POST | `/v1/learn/discussion/posts/:postId/replies` | `{ content }` | learner, moderator |
| PUT | `/v1/learn/discussion/posts/:postId` | `{ content }` | author (15 min), moderator |
| DELETE | `/v1/learn/discussion/posts/:postId` | — | author, moderator |
| PUT | `/v1/learn/discussion/posts/:postId/lock` | `{ locked }` | moderator; top-level posts only |
| PUT | `/v1/learn/track-items/:itemId/discussion/lock?tenantId=` | `{ locked }` | moderator |
| GET | `/v1/learn/track-items/:itemId/discussion/tenants` | — | moderator: organisations with posts on this item |

Mutations return the affected post (`DiscussionPost`, `replies: []`) or
`{ success: true }` (delete, discussion lock); clients refetch the GET.

### `GET …/discussion` response

```jsonc
{
  "trackId": "uuid",
  "trackItemId": "uuid",
  "tenantId": "string",
  "enabled": true,          // track_items.hasDiscussion; false ⇒ posts is []
  "isLocked": false,        // whole-discussion lock
  "postCount": 7,           // live posts incl. replies, excl. placeholders
  "viewer": {
    "userId": 42,
    "canModerate": false,
    "canPost": true,        // enabled && !isLocked && posting in own org
    "maxDepth": 3,
    "maxLength": 4000,
    "editWindowMinutes": 15
  },
  "posts": [                // top-level, newest first
    {
      "id": "uuid",
      "parentPostId": null,
      "depth": 1,           // 1 = top-level, max 3
      "author": { "id": 42, "name": "Asha K", "profileImageUrl": null }, // null once deleted by author
      "content": "text",    // null once deleted by author
      "isDeletedByAuthor": false,
      "isEdited": true,
      "editedByModerator": false,
      "isLocked": false,    // thread lock (top-level only; replies inherit)
      "isOwn": true,
      "createdAt": "ISO",
      "editedAt": "ISO|null",
      "editableUntil": "ISO|null", // when the author's edit window closes; null for others
      "canEdit": true,
      "canDelete": true,
      "canReply": true,
      "canLock": false,     // moderator && depth 1
      "replies": [ /* same shape, oldest first */ ]
    }
  ]
}
```

### Errors (message is user-presentable)

| Status | When |
|---|---|
| 400 | empty / over-length content; reply beyond depth 3; lock on a reply |
| 403 | not enrolled; item locked; discussion turned off; discussion or thread locked; edit window closed; not your post |
| 404 | item or post not found (including a post in another organisation) |

### Notification

`in_app_notifications` row, `type: "COURSE_DISCUSSION_REPLY"`,
title `New reply to your post`, body `<replier first name> replied to your post in "<item title>"`,
`data: { screen: "CourseDiscussion", trackId, itemId, postId }` where `postId`
is the new reply. Clients open the course item player at `itemId` and scroll
to / highlight `postId`.
