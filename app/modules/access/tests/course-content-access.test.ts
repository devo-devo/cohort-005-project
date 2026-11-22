import { describe, expect, it } from "vitest";
import { UserRole } from "~/db/schema";
import {
  decideCourseContentAccess,
  getCourseContentAccess,
  type CourseContentFacts,
} from "../index.server";

const student = { id: 7, role: UserRole.Student };
const owningInstructor = { id: 10, role: UserRole.Instructor };
const platformAdmin = { id: 99, role: UserRole.Admin };
const courseFacts = {
  instructorId: 10,
  price: 10_000,
  pppEnabled: true,
};

const facts = (overrides: Partial<CourseContentFacts> = {}): CourseContentFacts => ({
  actor: student,
  course: courseFacts,
  enrolled: false,
  purchaseCountry: null,
  currentCountry: null,
  ...overrides,
});

describe("getCourseContentAccess", () => {
  it("gives a signed-out visitor a non-throwing view with no content access", () => {
    const view = getCourseContentAccess(facts({ actor: null }));

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

  it("lets an enrolled Student read content when their discounted purchase matches their country", () => {
    const view = getCourseContentAccess(
      facts({ enrolled: true, purchaseCountry: "IN", currentCountry: "IN" })
    );

    expect(view).toEqual({
      actorId: 7,
      enrolled: true,
      canViewContent: true,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: false,
    });
  });

  it("blocks an enrolled Student whose discounted purchase is from another country", () => {
    const view = getCourseContentAccess(
      facts({ enrolled: true, purchaseCountry: "IN", currentCountry: "US" })
    );

    expect(view).toEqual({
      actorId: 7,
      enrolled: true,
      canViewContent: false,
      pppBlocked: true,
      pppBlockedCountry: "US",
      pppPurchaseCountry: "IN",
      canManageCourse: false,
    });
  });

  it("does not block a full-price purchase travelling in another country", () => {
    const view = getCourseContentAccess(
      facts({ enrolled: true, purchaseCountry: "US", currentCountry: "IN" })
    );

    expect(view).toEqual({
      actorId: 7,
      enrolled: true,
      canViewContent: true,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: false,
    });
  });

  it("does not block an unknown current country", () => {
    const view = getCourseContentAccess(
      facts({ enrolled: true, purchaseCountry: "IN", currentCountry: null })
    );

    expect(view.pppBlocked).toBe(false);
    expect(view.canViewContent).toBe(true);
  });

  it("does not block a purchase with no recorded country", () => {
    const view = getCourseContentAccess(
      facts({ enrolled: true, purchaseCountry: null, currentCountry: "US" })
    );

    expect(view.pppBlocked).toBe(false);
    expect(view.canViewContent).toBe(true);
  });

  it("does not run the PPP restriction when the course has PPP disabled", () => {
    const view = getCourseContentAccess(
      facts({
        enrolled: true,
        course: { ...courseFacts, pppEnabled: false },
        purchaseCountry: "IN",
        currentCountry: "US",
      })
    );

    expect(view.pppBlocked).toBe(false);
    expect(view.canViewContent).toBe(true);
  });

  it("does not run the PPP restriction for an unenrolled Student", () => {
    const view = getCourseContentAccess(
      facts({ purchaseCountry: "IN", currentCountry: "US" })
    );

    expect(view).toEqual({
      actorId: 7,
      enrolled: false,
      canViewContent: false,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: false,
    });
  });

  it("lets the owning Instructor manage and view the course despite a PPP mismatch", () => {
    const view = getCourseContentAccess(
      facts({
        actor: owningInstructor,
        enrolled: true,
        purchaseCountry: "IN",
        currentCountry: "US",
      })
    );

    expect(view).toEqual({
      actorId: 10,
      enrolled: true,
      canViewContent: true,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: true,
    });
  });

  it("lets a Platform Admin manage and view another Instructor's course despite a PPP mismatch", () => {
    const view = getCourseContentAccess(
      facts({
        actor: platformAdmin,
        enrolled: true,
        purchaseCountry: "IN",
        currentCountry: "US",
      })
    );

    expect(view).toEqual({
      actorId: 99,
      enrolled: true,
      canViewContent: true,
      pppBlocked: false,
      pppBlockedCountry: null,
      pppPurchaseCountry: null,
      canManageCourse: true,
    });
  });

  it("does not let an Instructor who does not own the course manage it", () => {
    const view = getCourseContentAccess(
      facts({ actor: { id: 11, role: UserRole.Instructor } })
    );

    expect(view.canManageCourse).toBe(false);
    expect(view.canViewContent).toBe(false);
  });

  it("lets a Platform Admin manage a course whose record is missing", () => {
    const view = getCourseContentAccess(
      facts({ actor: platformAdmin, course: null })
    );

    expect(view.canManageCourse).toBe(true);
    expect(view.canViewContent).toBe(true);
    expect(view.pppBlocked).toBe(false);
  });

  it("does not block an enrolled Student when the course record is missing", () => {
    const view = getCourseContentAccess(
      facts({ course: null, enrolled: true })
    );

    expect(view.canManageCourse).toBe(false);
    expect(view.canViewContent).toBe(true);
    expect(view.pppBlocked).toBe(false);
  });
});

describe("decideCourseContentAccess", () => {
  it("denies a signed-out visitor without mentioning HTTP at the policy seam", () => {
    expect(decideCourseContentAccess(facts({ actor: null }))).toEqual({
      allowed: false,
      reason: "signed-out",
    });
  });

  it("denies an unenrolled Student", () => {
    expect(decideCourseContentAccess(facts())).toEqual({
      allowed: false,
      reason: "content-denied",
    });
  });

  it("denies an enrolled Student blocked by PPP", () => {
    expect(
      decideCourseContentAccess(
        facts({ enrolled: true, purchaseCountry: "IN", currentCountry: "US" })
      )
    ).toEqual({ allowed: false, reason: "content-denied" });
  });

  it("allows an enrolled Student and returns their content view", () => {
    const decision = decideCourseContentAccess(facts({ enrolled: true }));

    expect(decision).toEqual({
      allowed: true,
      view: {
        actorId: 7,
        enrolled: true,
        canViewContent: true,
        pppBlocked: false,
        pppBlockedCountry: null,
        pppPurchaseCountry: null,
        canManageCourse: false,
      },
    });
  });

  it("allows the owning Instructor without an Enrollment", () => {
    const decision = decideCourseContentAccess(
      facts({ actor: owningInstructor })
    );

    expect(decision).toEqual({
      allowed: true,
      view: {
        actorId: 10,
        enrolled: false,
        canViewContent: true,
        pppBlocked: false,
        pppBlockedCountry: null,
        pppPurchaseCountry: null,
        canManageCourse: true,
      },
    });
  });
});
