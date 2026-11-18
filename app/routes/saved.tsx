import { Link } from "react-router";
import type { Route } from "./+types/saved";
import { db } from "~/db";
import {
  getBookmarksForStudent,
  getNotesForStudent,
} from "~/lib/bookmarks-notes.server";
import { requireUserId } from "~/lib/access.server";
import { Card, CardContent } from "~/components/ui/card";
import { Bookmark, NotebookPen } from "lucide-react";
import { formatRelativeTime } from "~/lib/utils";

export function meta() {
  return [
    { title: "Saved — Cadence" },
    { name: "description", content: "Your bookmarks and notes" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  return {
    savedBookmarks: getBookmarksForStudent(db, userId),
    savedNotes: getNotesForStudent(db, userId),
  };
}

function SavedSection({
  title,
  icon,
  isEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>

      {isEmpty ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function SavedRowCard({
  to,
  title,
  subtitle,
  children,
}: {
  to: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <Link to={to} className="text-sm font-medium hover:underline">
          {title}
        </Link>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const { savedBookmarks, savedNotes } = loaderData;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-muted-foreground">
          The lessons you flagged, and what you wrote about them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SavedSection
          title="Bookmarks"
          icon={<Bookmark className="size-4 text-muted-foreground" />}
          isEmpty={savedBookmarks.length === 0}
          emptyMessage="No bookmarks yet."
        >
          {savedBookmarks.map((bookmark) => (
            <SavedRowCard
              key={bookmark.id}
              to={`/courses/${bookmark.courseSlug}/lessons/${bookmark.lessonId}`}
              title={bookmark.lessonTitle}
              subtitle={`${bookmark.courseTitle} · ${bookmark.moduleTitle}`}
            />
          ))}
        </SavedSection>

        <SavedSection
          title="Notes"
          icon={<NotebookPen className="size-4 text-muted-foreground" />}
          isEmpty={savedNotes.length === 0}
          emptyMessage="No notes yet."
        >
          {savedNotes.map((note) => (
            <SavedRowCard
              key={note.id}
              to={`/courses/${note.courseSlug}/lessons/${note.lessonId}`}
              title={note.lessonTitle}
              subtitle={note.courseTitle}
            >
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              <p
                suppressHydrationWarning
                className="text-xs text-muted-foreground"
              >
                Edited {formatRelativeTime(note.updatedAt)}
              </p>
            </SavedRowCard>
          ))}
        </SavedSection>
      </div>
    </div>
  );
}
