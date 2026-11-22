import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import { createAccessGuards } from "../index.server";
import {
  deniedBy,
  seedRequestFixtures,
  signedInRequest,
} from "./request-fixtures";

const BASE_URL = "http://localhost/";

describe("signed-in, course-manager and Instructor-area Request adapters", () => {
  let database: TestDb;
  let fixtures: ReturnType<typeof seedRequestFixtures>;
  let guards: ReturnType<typeof createAccessGuards>;

  beforeEach(() => {
    database = createTestDb();
    fixtures = seedRequestFixtures(database);
    guards = createAccessGuards(database);
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
      const admin = await signedInRequest(fixtures.platformAdminId);

      expect(
        await guards.requireCourseManager(instructor, fixtures.course.id)
      ).toEqual({
        actorId: fixtures.instructor.id,
        canManageCourse: true,
      });
      expect(
        await guards.requireCourseManager(admin, fixtures.course.id)
      ).toEqual({
        actorId: fixtures.platformAdminId,
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
      const admin = await signedInRequest(fixtures.platformAdminId);

      expect(await guards.requireInstructorOrPlatformAdmin(instructor)).toEqual(
        {
          userId: fixtures.instructor.id,
          isAdmin: false,
        }
      );
      expect(await guards.requireInstructorOrPlatformAdmin(admin)).toEqual({
        userId: fixtures.platformAdminId,
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
