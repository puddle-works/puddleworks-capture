// What the viewer page is sent. Types only, shared by the server and the page
// (web/src), so the two can't drift apart.
import type {
  ExportRecord,
  Message,
  Participant,
  RequestStatus,
  SpecificationVersion,
  Transition,
} from "../domain/model.ts";
import type { OldHistory } from "./ports.ts";

export type { OldHistory, RequestStatus };

export interface PersonRef {
  userId: string;
  name: string;
}

/** A request in the list. */
export interface WebSummary {
  id: string;
  /** What people call it, such as 12 for #12; null if saved before numbers. */
  number: number | null;
  title: string;
  status: RequestStatus;
  outcomeOwner: PersonRef;
  participantCount: number;
  openQuestionCount: number;
  /** The latest specification version, or null before there is one. */
  specificationVersion: number | null;
  /** Brought in from the old Puddleworks app. */
  imported: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One request with everything on it. */
export interface WebRequest extends WebSummary {
  initialDescription: string;
  currentProcess: string;
  /** The phrase the recipe must answer as asked, or null if none was given. */
  requestedPhrase: string | null;
  closedReason: string | null;
  participants: Participant[];
  messages: Message[];
  specifications:
    (SpecificationVersion & { createdByName: string; problems: string[] })[];
  agreements: {
    specVersion: number;
    agreedBy: PersonRef;
    agreedAt: string;
    specHash: string;
  }[];
  exports: (ExportRecord & { exportedByName: string })[];
  transitions: (Transition & { byName: string })[];
  before: OldHistory | null;
}

/** Someone in the people list. */
export interface WebPerson {
  name: string;
  email: string;
  isBuilder: boolean;
}

/** Everything the list page shows. */
export interface WebOverview {
  requests: WebSummary[];
  people: WebPerson[];
  /** When the viewer last read swamp data. */
  readAt: string;
}

/** What the event stream says: something changed, so read again. */
export interface WebEvent {
  type: "changed";
}
