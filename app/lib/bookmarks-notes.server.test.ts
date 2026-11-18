import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  MAX_NOTE_LENGTH,
  getBookmark,
  getBookmarksForStudent,
  getNote,
  getNotesForStudent,
  saveNote,
  toggleBookmark,
} from "./bookmarks-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 9, 30, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let otherStudent: typeof schema.users.$inferSelect;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  otherStudent = db
    .insert(schema.users)
    .values({
      name: "Other Student",
      email: "other@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();

  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function key(userId = base.user.id, lessonId = lessonIds[0]) {
  return { userId, lessonId };
}

describe("bookmarks", () => {
  it("creates a Bookmark on the first press and removes it on the second", () => {
    expect(getBookmark(db, key())).toBeUndefined();

    expect(toggleBookmark(db, key())).toBe(true);
    expect(getBookmark(db, key())).toMatchObject({
      userId: base.user.id,
      lessonId: lessonIds[0],
    });

    expect(toggleBookmark(db, key())).toBe(false);
    expect(getBookmark(db, key())).toBeUndefined();
  });

  it("lets the database refuse a second Bookmark on the same Lesson", () => {
    toggleBookmark(db, key());

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();

    expect(
      db
        .select()
        .from(schema.bookmarks)
        .where(eq(schema.bookmarks.userId, base.user.id))
        .all()
    ).toHaveLength(1);
  });
});

describe("notes", () => {
  it("creates a Note, then replaces its body and moves last-edited on re-save", () => {
    const first = saveNote(db, key(), "  first draft  ", NOW);
    if (!first.ok) throw new Error(first.error);

    expect(first.note).toMatchObject({
      userId: base.user.id,
      lessonId: lessonIds[0],
      body: "first draft",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const second = saveNote(db, key(), "second draft", LATER);
    if (!second.ok) throw new Error(second.error);

    expect(second.note).toMatchObject({
      id: first.note.id,
      body: "second draft",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(
      db
        .select()
        .from(schema.notes)
        .where(eq(schema.notes.userId, base.user.id))
        .all()
    ).toHaveLength(1);
  });

  it("accepts a Note at exactly 2,000 characters", () => {
    const body = "x".repeat(MAX_NOTE_LENGTH);

    expect(saveNote(db, key(), body, NOW)).toMatchObject({
      ok: true,
      note: { body },
    });
  });

  it("refuses a Note over 2,000 characters without saving one", () => {
    expect(saveNote(db, key(), "x".repeat(MAX_NOTE_LENGTH + 1), NOW)).toEqual({
      ok: false,
      error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
    });
    expect(db.select().from(schema.notes).all()).toHaveLength(0);
  });

  it("lets the database refuse a second Note on the same Lesson", () => {
    saveNote(db, key(), "first", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({
          userId: base.user.id,
          lessonId: lessonIds[0],
          body: "second",
        })
        .run()
    ).toThrow();
  });
});

describe("Saved lists", () => {
  it("contains only the Student's rows, newest first, with Lesson and Course", () => {
    db.insert(schema.bookmarks)
      .values([
        { userId: base.user.id, lessonId: lessonIds[0], createdAt: NOW.toISOString() },
        { userId: base.user.id, lessonId: lessonIds[1], createdAt: LATER.toISOString() },
        { userId: otherStudent.id, lessonId: lessonIds[0], createdAt: LATER.toISOString() },
      ])
      .run();
    db.insert(schema.notes)
      .values([
        {
          userId: base.user.id,
          lessonId: lessonIds[0],
          body: "older note",
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
        {
          userId: base.user.id,
          lessonId: lessonIds[1],
          body: "newer note",
          createdAt: NOW.toISOString(),
          updatedAt: LATER.toISOString(),
        },
        {
          userId: otherStudent.id,
          lessonId: lessonIds[0],
          body: "someone else's note",
          createdAt: NOW.toISOString(),
          updatedAt: LATER.toISOString(),
        },
      ])
      .run();

    const bookmarks = getBookmarksForStudent(db, base.user.id);
    expect(bookmarks.map((row) => row.lessonId)).toEqual([
      lessonIds[1],
      lessonIds[0],
    ]);
    expect(bookmarks[0]).toMatchObject({
      lessonTitle: "Lesson 2",
      moduleTitle: "Basics",
      courseTitle: base.course.title,
      courseSlug: base.course.slug,
    });

    const notes = getNotesForStudent(db, base.user.id);
    expect(notes.map((row) => row.body)).toEqual(["newer note", "older note"]);
    expect(notes[0]).toMatchObject({
      lessonTitle: "Lesson 2",
      courseTitle: base.course.title,
      courseSlug: base.course.slug,
    });
  });

  it("names the Course each Lesson belongs to", () => {
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "Another Course",
        slug: "another-course",
        description: "Another test course",
        salesCopy: "## Another Course",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const mod = db
      .insert(schema.modules)
      .values({ courseId: otherCourse.id, title: "Intro", position: 1 })
      .returning()
      .get();
    const lesson = db
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: "Other Lesson", position: 1 })
      .returning()
      .get();

    db.insert(schema.bookmarks)
      .values({ userId: base.user.id, lessonId: lesson.id })
      .run();

    expect(getBookmarksForStudent(db, base.user.id)).toMatchObject([
      {
        lessonTitle: "Other Lesson",
        moduleTitle: "Intro",
        courseTitle: "Another Course",
        courseSlug: "another-course",
      },
    ]);
  });
});

describe("approving a Refund Request", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "admin@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    toggleBookmark(db, key());
    saveNote(db, key(), "worth keeping", NOW);

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not what I expected.",
      NOW,
      fakeNotifications()
    );
    if (!raised.ok) throw new Error(raised.error);

    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      admin.id,
      null,
      NOW,
      fakeNotifications()
    );
    expect(approved.ok).toBe(true);

    expect(getBookmark(db, key())).toBeDefined();
    expect(getNote(db, key())).toMatchObject({ body: "worth keeping" });
    expect(getBookmarksForStudent(db, base.user.id)).toHaveLength(1);
    expect(getNotesForStudent(db, base.user.id)).toHaveLength(1);
  });
});
