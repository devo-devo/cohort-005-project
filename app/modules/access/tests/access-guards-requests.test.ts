import { beforeEach, describe, expect, it } from "vitest";
import { users, UserRole } from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import { createAccessGuards } from "../index.server";

const BASE_URL = "http://localhost/";

type Denial = { status: number; message: string };

function isDenial(
  error: unknown
): error is { data: string; init: { status: number } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    "init" in error
  );
}

async function deniedBy(run: () => Promise<unknown>): Promise<Denial> {
  try {
    await run();
  } catch (error) {
    if (isDenial(error)) {
      return { status: error.init.status, message: error.data };
    }
    throw error;
  }
  throw new Error("Expected the access guard to deny the request");
}

async function signedInRequest(userId: number) {
  const cookie = await setCurrentUserId(new Request(BASE_URL), userId);
  return new Request(BASE_URL, { headers: { Cookie: cookie } });
}

describe("signed-in, course-manager and Instructor-area Request adapters", () => {
  let database: TestDb;
  let fixtures: ReturnType<typeof seedBaseData>;
  let guards: ReturnType<typeof createAccessGuards>;
  let platformAdminId: number;

  beforeEach(() => {
    database = createTestDb();
    fixtures = seedBaseData(database);
    guards = createAccessGuards(database);
    platformAdminId = database
      .insert(users)
      .values({
        name: "Test Platform Admin",
        email: "admin@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get().id;
  });

  describe("requireSignedInActor", () => {
    it("maps a signed-out visitor to a 401 with the DevUI message", async () => {
      expect(
        await deniedBy(() => guards.requireSignedInActor(new Request(BASE_URL)))
      ).toEqual({
        status: 401,
        message: "Select a user from the DevUI panel.",
      });
    });

    it("returns the session actor id without requiring a user record", async () => {
      const request = await signedInRequest(123456);

      expect(await guards.requireSignedInActor(request)).toBe(123456);
    });
  });

  describe("requireCourseManager", () => {
    it("maps a signed-out visitor to a 401 before reading the course", async () => {
      expect(
        await deniedBy(() =>
          guards.requireCourseManager(new Request(BASE_URL), fixtures.course.id)
        )
      ).toEqual({
        status: 401,
        message: "Select a user from the DevUI panel.",
      });
    });

    it("maps a Student to a 403 with the course-instructor message", async () => {
      const request = await signedInRequest(fixtures.user.id);

      expect(
        await deniedBy(() =>
          guards.requireCourseManager(request, fixtures.course.id)
        )
      ).toEqual({
        status: 403,
        message: "Only this course's instructor can do that.",
      });
    });

    it("allows the owning Instructor and a Platform Admin", async () => {
      const instructor = await signedInRequest(fixtures.instructor.id);
      const admin = await signedInRequest(platformAdminId);

      expect(await guards.requireCourseManager(instructor, fixtures.course.id)).toEqual({
        actorId: fixtures.instructor.id,
        canManageCourse: true,
      });
      expect(await guards.requireCourseManager(admin, fixtures.course.id)).toEqual({
        actorId: platformAdminId,
        canManageCourse: true,
      });
    });

    it("treats a session actor with no user record as signed out", async () => {
      const request = await signedInRequest(123456);

      expect(
        await deniedBy(() =>
          guards.requireCourseManager(request, fixtures.course.id)
        )
      ).toEqual({
        status: 401,
        message: "Select a user from the DevUI panel.",
      });
    });
  });

  describe("requireInstructorOrPlatformAdmin", () => {
    it("checks sign-in before the role", async () => {
      expect(
        await deniedBy(() =>
          guards.requireInstructorOrPlatformAdmin(new Request(BASE_URL))
        )
      ).toEqual({
        status: 401,
        message: "Select a user from the DevUI panel.",
      });
    });

    it("maps a Student to a 403 with the instructor-area message", async () => {
      const request = await signedInRequest(fixtures.user.id);

      expect(
        await deniedBy(() => guards.requireInstructorOrPlatformAdmin(request))
      ).toEqual({
        status: 403,
        message: "Only instructors can access this page.",
      });
    });

    it("returns the id and admin flag for an Instructor or Platform Admin", async () => {
      const instructor = await signedInRequest(fixtures.instructor.id);
      const admin = await signedInRequest(platformAdminId);

      expect(await guards.requireInstructorOrPlatformAdmin(instructor)).toEqual({
        userId: fixtures.instructor.id,
        isAdmin: false,
      });
      expect(await guards.requireInstructorOrPlatformAdmin(admin)).toEqual({
        userId: platformAdminId,
        isAdmin: true,
      });
    });

    it("denies a session actor with no user record with a 403", async () => {
      const request = await signedInRequest(123456);

      expect(
        await deniedBy(() => guards.requireInstructorOrPlatformAdmin(request))
      ).toEqual({
        status: 403,
        message: "Only instructors can access this page.",
      });
    });
  });
});
