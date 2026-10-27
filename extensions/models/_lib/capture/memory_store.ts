// The store the tests use: plain maps, copied on the way in and out so a
// use case can't change what is saved without saving it.
import type { Person } from "../domain/index.ts";
import type { CaptureStore, Stored } from "./ports.ts";

export class MemoryStore implements CaptureStore {
  requests = new Map<string, Stored>();
  people = new Map<string, Person>();
  saves = 0;

  getRequest(id: string): Promise<Stored | undefined> {
    const stored = this.requests.get(id);
    return Promise.resolve(stored && structuredClone(stored));
  }

  allRequests(): Promise<Stored[]> {
    return Promise.resolve(
      [...this.requests.values()].map((s) => structuredClone(s)),
    );
  }

  saveRequest(stored: Stored): Promise<void> {
    this.saves++;
    this.requests.set(stored.request.id, structuredClone(stored));
    return Promise.resolve();
  }

  allPeople(): Promise<Person[]> {
    return Promise.resolve([...this.people.values()].map((p) => ({ ...p })));
  }

  savePerson(person: Person): Promise<void> {
    this.people.set(person.userId, { ...person });
    return Promise.resolve();
  }
}
