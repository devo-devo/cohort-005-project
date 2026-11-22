import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import { createCourseContentAccess } from "../index.server";

const BASE_URL = "http://localhost/";

type Denial = { status: number; message: string };

function isDenial(error: unknown): error is { data: string; init: { status: number } } {
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

async function signedInRequest(
  userId: number,
  headers: Record<string, string> = {}
) {
  const cookie = await setCurrentUserId(
    new Request(BASE_URL, { headers }),
    userId
  );
  return new Request(BASE_URL, {
    headers: { ...headers, Cookie: cookie },
  });
}

describe("course content access Request adapters", () => {
  let database: TestDb;
  let fixtures: ReturnType<typeof seedBaseData>;
  let access: ReturnType<typeof createCourseContentAccess>;

  beforeEach(() => {
    database = createTestDb();
    fixtures = seedBaseData(database);
    access = createCourseContentAccess(database);
  });

  const enroll = (userId: number, courseId: number) => {
    database.insert(schema.enrollments).values({ userId, courseId }).run();
  };

  it("returns a content view without throwing for a signed-out visitor", async () => {
    const view = await access.getView(new Request(BASE_URL), fixtures.course.id);

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

    expect(await deniedBy(() => access.require(request, fixtures.course.id))).toEqual({
      status: 403,
      message: "You must be enrolled in this course.",
    });
  });

  it("resolves an enrolled Student into a content view for both adapters", async () => {
    enroll(fixtures.user.id, fixtures.course.id);
    const request = await signedInRequest(fixtures.user.id);

    const view = await access.getView(request, fixtures.course.id);
    const required = await access.require(request, fixtures.course.id);

    expect(view).toEqual({
      actorId: fixtures.user.id,
      enrolled: true,
      canViewContent: true,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: false,
    });
    expect(required).toEqual(view);
  });

  it("lets the owning Instructor through without an Enrollment", async () => {
    const request = await signedInRequest(fixtures.instructor.id);

    const view = await access.require(request, fixtures.course.id);

    expect(view.canManageCourse).toBe(true);
    expect(view.canViewContent).toBe(true);
  });

  it("applies the PPP restriction resolved from the purchase and request country", async () => {
    database
      .update(schema.courses)
      .set({ price: 10_000, pppEnabled: true })
      .where(eq(schema.courses.id, fixtures.course.id))
      .run();
    enroll(fixtures.user.id, fixtures.course.id);
    database
      .insert(schema.purchases)
      .values({
        userId: fixtures.user.id,
        courseId: fixtures.course.id,
        amountPaid: 5_000,
        country: "IN",
      })
      .run();
    const request = await signedInRequest(fixtures.user.id, {
      "CF-IPCountry": "US",
    });

    const view = await access.getView(request, fixtures.course.id);

    expect(view.canViewContent).toBe(false);
    expect(view.pppBlocked).toBe(true);
    expect(view.pppBlockedCountry).toBe("US");
    expect(view.pppPurchaseCountry).toBe("IN");
    expect(
      await deniedBy(() => access.require(request, fixtures.course.id))
    ).toEqual({
      status: 403,
      message: "You must be enrolled in this course.",
    });
  });

  it("treats a session actor with no user record as signed out", async () => {
    const request = await signedInRequest(123456);

    expect(await access.getView(request, fixtures.course.id)).toMatchObject({
      actorId: null,
      canViewContent: false,
    });
  });
});
