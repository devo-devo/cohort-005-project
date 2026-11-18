import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";

// ─── Bookmarks and Notes ───
// A Student's own Bookmarks and Notes on Lessons. See GLOSSARY.md: neither is
// ever read by anyone other than the Student who wrote it.
//
// Every function takes the database first so tests can hand in an in-memory
// one. Positional parameters follow the other service modules.

export type Db = BetterSQLite3Database<typeof schema>;

export const MAX_NOTE_LENGTH = 2000;

/** The pair identifying one Student's Bookmark or Note on one Lesson. */
export type StudentLessonKey = {
  userId: number;
  lessonId: number;
};

export type Bookmark = typeof bookmarks.$inferSelect;
export type Note = typeof notes.$inferSelect;

export type SavedLessonRef = {
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  courseTitle: string;
  courseSlug: string;
};

export type SavedBookmark = SavedLessonRef & {
  id: number;
  createdAt: string;
};

export type SavedNote = SavedLessonRef & {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function getBookmark(
  db: Db,
  key: StudentLessonKey
): Bookmark | undefined {
  return db
    .select()
    .from(bookmarks)
    .where(
      and(eq(bookmarks.userId, key.userId), eq(bookmarks.lessonId, key.lessonId))
    )
    .get();
}

/** Adds or removes the Student's one Bookmark; returns whether it is now set. */
export function toggleBookmark(db: Db, key: StudentLessonKey): boolean {
  const existing = getBookmark(db, key);

  if (existing) {
    db.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run();
    return false;
  }

  db.insert(bookmarks)
    .values({ userId: key.userId, lessonId: key.lessonId })
    .run();
  return true;
}

export function getNote(db: Db, key: StudentLessonKey): Note | undefined {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, key.userId), eq(notes.lessonId, key.lessonId)))
    .get();
}

export type SaveNoteResult =
  | { ok: true; note: Note }
  | { ok: false; error: string };

/**
 * Creates or replaces the Student's one Note on the Lesson. The body is
 * trimmed and capped at MAX_NOTE_LENGTH; an over-long Note is refused rather
 * than truncated. Re-saving keeps createdAt and moves updatedAt on.
 */
export function saveNote(
  db: Db,
  key: StudentLessonKey,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    };
  }

  const existing = getNote(db, key);
  const timestamp = now.toISOString();

  if (existing) {
    const note = db
      .update(notes)
      .set({ body: trimmed, updatedAt: timestamp })
      .where(eq(notes.id, existing.id))
      .returning()
      .get();
    return { ok: true, note };
  }

  const note = db
    .insert(notes)
    .values({
      userId: key.userId,
      lessonId: key.lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();
  return { ok: true, note };
}

/** One query for the Lesson → Module → Course details of a set of rows. */
function getLessonRefs(
  db: Db,
  lessonIds: number[]
): Map<number, SavedLessonRef> {
  if (lessonIds.length === 0) return new Map();

  const rows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(inArray(lessons.id, lessonIds))
    .all();

  return new Map(rows.map((row) => [row.lessonId, row]));
}

/** The Student's Bookmarks, newest first, with their Lesson and Course. */
export function getBookmarksForStudent(
  db: Db,
  userId: number
): SavedBookmark[] {
  const rows = db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
  const refs = getLessonRefs(
    db,
    rows.map((row) => row.lessonId)
  );

  return rows.flatMap((row) => {
    const ref = refs.get(row.lessonId);
    return ref ? [{ id: row.id, createdAt: row.createdAt, ...ref }] : [];
  });
}

/** The Student's Notes, last edited first, with their Lesson and Course. */
export function getNotesForStudent(db: Db, userId: number): SavedNote[] {
  const rows = db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
  const refs = getLessonRefs(
    db,
    rows.map((row) => row.lessonId)
  );

  return rows.flatMap((row) => {
    const ref = refs.get(row.lessonId);
    return ref
      ? [
          {
            id: row.id,
            body: row.body,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            ...ref,
          },
        ]
      : [];
  });
}
