import {
  agree,
  createRequest,
  editSpecification,
  type Person,
  propose,
  type Request,
  type SpecificationContent,
  submit,
} from "./index.ts";

export const owner: Person = {
  userId: "u-owner",
  name: "Olive Owner",
  email: "olive@example.com",
  isBuilder: false,
};
export const builder: Person = {
  userId: "u-builder",
  name: "Bea Builder",
  email: "bea@example.com",
  isBuilder: true,
};
export const otherBuilder: Person = {
  userId: "u-builder-2",
  name: "Bo Builder",
  email: "bo@example.com",
  isBuilder: true,
};
export const colleague: Person = {
  userId: "u-colleague",
  name: "Cal Colleague",
  email: "cal@example.com",
  isBuilder: false,
};
export const reviewer: Person = {
  userId: "u-reviewer",
  name: "Rae Reviewer",
  email: "rae@example.com",
  isBuilder: false,
};
export const stranger: Person = {
  userId: "u-stranger",
  name: "Sam Stranger",
  email: "sam@example.com",
  isBuilder: false,
};

export const T0 = "2026-10-22T09:00:00.000Z";
export const T1 = "2026-10-22T10:00:00.000Z";
export const T2 = "2026-10-22T11:00:00.000Z";

export const goodSpec: SpecificationContent = {
  problemStatement: "Weekly stock counts are typed into a spreadsheet by hand.",
  desiredOutcome: "Counts are entered once and the order list is ready.",
  scope: { in: ["Entering counts", "Order list"], out: ["Supplier ordering"] },
  constraints: ["Works on a phone in the stockroom"],
  assumptions: ["One stockroom"],
  acceptanceCriteria: [
    { id: "AC1", text: "A count can be entered in under a minute" },
    { id: "AC2", text: "The order list matches the spreadsheet for last week" },
  ],
};

export function draftRequest(): Request {
  return createRequest(
    {
      id: "r-1",
      title: "Stock counts",
      initialDescription: "We count stock every Friday.",
      currentProcess: "Paper sheet, then a spreadsheet.",
    },
    owner,
    T0,
  );
}

/** Submitted, with the builder joined. */
export function discussingRequest(): Request {
  const r = submit(draftRequest(), owner, T0);
  return joinBuilder(r);
}

function joinBuilder(r: Request): Request {
  return {
    ...r,
    participants: [
      ...r.participants,
      {
        userId: builder.userId,
        name: builder.name,
        email: builder.email,
        role: "builder",
        invitedBy: null,
        joinedAt: T0,
      },
    ],
  };
}

export function readyRequest(): Request {
  const r = editSpecification(discussingRequest(), builder, goodSpec, [], T1);
  return propose(r, builder, T1);
}

export function agreedRequest(): Request {
  return agree(readyRequest(), owner, { version: 1, specHash: "hash-v1" }, T2);
}
