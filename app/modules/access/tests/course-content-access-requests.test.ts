import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import { createCourseContentAccess } from "../index.server";
import {
  deniedBy,
  seedRequestFixtures,
  signedInRequest,
} from "./request-fixtures";

const BASE_URL = "http://localhost/";

describe("course content access Request adapters", () => {
  let database: TestDb;
  let fixtures: ReturnType<typeof seedRequestFixtures>;
  let access: ReturnType<typeof createCourseContentAccess>;

  beforeEach(() => {
    database = createTestDb();
    fixtures = seedRequestFixtures(database);
    access = createCourseContentAccess(database);
  });

  it("returns a content view without throwing for a signed-out visitor", async () => {
    const view = await access.getView(
      new Request(BASE_URL),
      fixtures.course.id
    );

    expect(view).toEqual({
      actorId: null,
      enrolled: false,
      canViewContent: false,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: false,
    });
  });

  it("maps a signed-out visitor to a 401 with the DevUI message", async () => {
    expect(
      await deniedBy(() => access.require(new Request(BASE_URL), 1))
    ).toEqual({
      status: 401,
      message: "Select a user from the DevUI panel.",
    });
  });

  it("maps an unenrolled Student to a 403 with the enrollment message", async () => {
    const request = await signedInRequest(fixtures.user.id);

    expect(
      await deniedBy(() => access.require(request, fixtures.course.id))
    ).toEqual({
      status: 403,
      message: "You must be enrolled in this course.",
    });
  });

  it("lets the owning Instructor through without an Enrollment", async () => {
    const request = await signedInRequest(fixtures.instructor.id);

    const view = await access.require(request, fixtures.course.id);

    expect(view.canManageCourse).toBe(true);
    expect(view.canViewContent).toBe(true);
  });

  it("treats a session actor with no user record as signed out", async () => {
    const request = await signedInRequest(123456);

    expect(await access.getView(request, fixtures.course.id)).toMatchObject({
      actorId: null,
      canViewContent: false,
    });
  });
});
