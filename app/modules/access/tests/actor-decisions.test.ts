import { describe, expect, it } from "vitest";
import { UserRole } from "~/db/schema";
import {
  decideCourseManagerAccess,
  decideInstructorOrPlatformAdminAccess,
  decideSignedInActor,
  type CourseManagerFacts,
} from "../index.server";

describe("decideSignedInActor", () => {
  it("allows a resolved actor id", () => {
    expect(decideSignedInActor(42)).toEqual({ allowed: true, actorId: 42 });
  });

  it("denies a visitor with no actor", () => {
    expect(decideSignedInActor(null)).toEqual({
      allowed: false,
      reason: "signed-out",
    });
  });
});

const student = { id: 7, role: UserRole.Student };
const owningInstructor = { id: 10, role: UserRole.Instructor };
const otherInstructor = { id: 11, role: UserRole.Instructor };
const platformAdmin = { id: 99, role: UserRole.Admin };

const courseManagerFacts = (
  overrides: Partial<CourseManagerFacts> = {}
): CourseManagerFacts => ({
  actor: student,
  course: { instructorId: 10 },
  ...overrides,
});

describe("decideCourseManagerAccess", () => {
  it("allows the Instructor who owns the course", () => {
    expect(
      decideCourseManagerAccess(
        courseManagerFacts({ actor: owningInstructor })
      )
    ).toEqual({ allowed: true, view: { actorId: 10, canManageCourse: true } });
  });

  it("allows a Platform Admin for another Instructor's course", () => {
    expect(
      decideCourseManagerAccess(courseManagerFacts({ actor: platformAdmin }))
    ).toEqual({ allowed: true, view: { actorId: 99, canManageCourse: true } });
  });

  it("allows a Platform Admin when the course record is missing", () => {
    expect(
      decideCourseManagerAccess(
        courseManagerFacts({ actor: platformAdmin, course: null })
      )
    ).toEqual({ allowed: true, view: { actorId: 99, canManageCourse: true } });
  });

  it("denies an Instructor who does not own the course", () => {
    expect(
      decideCourseManagerAccess(
        courseManagerFacts({ actor: otherInstructor })
      )
    ).toEqual({ allowed: false, reason: "not-course-manager" });
  });

  it("denies a Student", () => {
    expect(decideCourseManagerAccess(courseManagerFacts())).toEqual({
      allowed: false,
      reason: "not-course-manager",
    });
  });

  it("denies a signed-out visitor without a course record", () => {
    expect(
      decideCourseManagerAccess(
        courseManagerFacts({ actor: null, course: null })
      )
    ).toEqual({ allowed: false, reason: "signed-out" });
  });
});

describe("decideInstructorOrPlatformAdminAccess", () => {
  it("allows an Instructor and reports they are not a Platform Admin", () => {
    expect(
      decideInstructorOrPlatformAdminAccess({ actor: owningInstructor })
    ).toEqual({ allowed: true, view: { actorId: 10, isAdmin: false } });
  });

  it("allows a Platform Admin and reports their role", () => {
    expect(
      decideInstructorOrPlatformAdminAccess({ actor: platformAdmin })
    ).toEqual({ allowed: true, view: { actorId: 99, isAdmin: true } });
  });

  it("denies a Student", () => {
    expect(decideInstructorOrPlatformAdminAccess({ actor: student })).toEqual({
      allowed: false,
      reason: "not-instructor-or-admin",
    });
  });

  it("denies a signed-out visitor", () => {
    expect(decideInstructorOrPlatformAdminAccess({ actor: null })).toEqual({
      allowed: false,
      reason: "signed-out",
    });
  });
});
