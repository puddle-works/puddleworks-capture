import { z } from "npm:zod@4.6.5";

export const REQUEST_STATUSES = [
  "draft",
  "discussing",
  "ready_for_agreement",
  "agreed",
  "exported",
  "withdrawn",
  "declined",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const TERMINAL_STATUSES: readonly RequestStatus[] = [
  "withdrawn",
  "declined",
];

export const ROLES = [
  "outcome_owner",
  "builder",
  "observer",
  "reviewer",
] as const;
export type Role = (typeof ROLES)[number];

/** Who is acting. `isBuilder` says they are one of the platform's builders. */
export interface Person {
  userId: string;
  name: string;
  email: string;
  isBuilder: boolean;
}

/** Name and email are copied when someone joins, so exports read the same later. */
export interface Participant {
  userId: string;
  name: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  joinedAt: string;
}

export const MESSAGE_KINDS = ["comment", "question", "decision"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export interface Message {
  id: string;
  authorId: string;
  authorName: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionMessageId: string | null;
}

const text = z.string().max(10_000);
const list = z.array(z.string().max(2_000)).max(100);

export const SpecificationContentSchema = z.object({
  problemStatement: text,
  desiredOutcome: text,
  scope: z.object({ in: list, out: list }),
  constraints: list,
  assumptions: list,
  acceptanceCriteria: z
    .array(
      z.object({ id: z.string().min(1).max(40), text: z.string().max(2_000) }),
    )
    .max(100),
});
export type SpecificationContent = z.infer<typeof SpecificationContentSchema>;

export const SPEC_STATUSES = [
  "draft",
  "proposed",
  "changes_requested",
  "agreed",
  "superseded",
] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];

export interface SpecificationVersion {
  version: number;
  status: SpecStatus;
  content: SpecificationContent;
  basedOnMessageIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agreement {
  specVersion: number;
  agreedBy: string;
  agreedAt: string;
  /** SHA-256 of specHashInput(content), worked out by the caller. */
  specHash: string;
}

export const EXPORT_FORMATS = ["outcome-spec/v1+json", "markdown"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportRecord {
  specVersion: number;
  format: ExportFormat;
  exportedBy: string;
  exportedAt: string;
}

export interface Transition {
  from: RequestStatus;
  to: RequestStatus;
  action: string;
  by: string;
  at: string;
  note: string | null;
}

/**
 * One request and everything on it. Plain, serialisable data: every domain
 * function takes one and returns a new one, never changing its argument.
 */
export interface Request {
  id: string;
  title: string;
  initialDescription: string;
  currentProcess: string;
  outcomeOwnerId: string;
  status: RequestStatus;
  closedReason: string | null;
  participants: Participant[];
  messages: Message[];
  specifications: SpecificationVersion[];
  agreements: Agreement[];
  exports: ExportRecord[];
  transitions: Transition[];
  createdAt: string;
  updatedAt: string;
}

export const NewRequestSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1, "Give the request a title.").max(200),
  initialDescription: z.string().trim().max(20_000),
  currentProcess: z.string().trim().max(20_000).default(""),
});
export type NewRequest = z.input<typeof NewRequestSchema>;
