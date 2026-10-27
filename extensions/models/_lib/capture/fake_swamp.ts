// A stand-in for the part of swamp's method context the Capture behaviors
// use: data written by instance name, read back by name or by spec.
export interface FakeRecord {
  name: string;
  specName: string;
  version: number;
  modelType: string;
  modelName: string;
  attributes: Record<string, unknown>;
}

export class FakeSwamp {
  /** Every version written, oldest first. */
  written: FakeRecord[] = [];
  /** Every handle writeResource gave out; swamp accepts no others. */
  issued = new Set<object>();
  logs: string[] = [];

  constructor(
    readonly modelName = "capture",
    readonly modelType = "@puddleworks/capture/requests",
  ) {}

  latest(): FakeRecord[] {
    const byName = new Map<string, FakeRecord>();
    for (const r of this.written) byName.set(r.name, r);
    return [...byName.values()];
  }

  context<G>(globalArgs: G, repoDir = "/repo") {
    return {
      globalArgs,
      repoDir,
      definition: { id: "def-1", name: this.modelName, version: "1", tags: {} },
      logger: {
        info: (message: string, props?: Record<string, unknown>) => {
          this.logs.push(
            message.replace(/\{(\w+)\}/g, (_, k) => String(props?.[k])),
          );
        },
      },
      writeResource: (
        specName: string,
        name: string,
        data: Record<string, unknown>,
      ) => {
        const version = this.written.filter((r) => r.name === name).length + 1;
        this.written.push({
          name,
          specName,
          version,
          modelType: this.modelType,
          modelName: this.modelName,
          // swamp stores JSON, so nothing written shares objects with the caller.
          attributes: JSON.parse(JSON.stringify(data)),
        });
        // Shaped like swamp's own handles, which a method must hand back
        // as they came: a made-up { name } fails swamp's output check.
        const handle = { name, dataId: `data-${name}`, version, tags: {} };
        this.issued.add(handle);
        return Promise.resolve(handle);
      },
      readResource: (name: string) => {
        const found = this.latest().find((r) => r.name === name);
        return Promise.resolve(
          found ? structuredClone(found.attributes) : null,
        );
      },
      readModelData: (modelName: string, specName?: string) =>
        Promise.resolve(
          this.latest()
            .filter((r) =>
              r.modelName === modelName &&
              (specName === undefined || r.specName === specName)
            )
            .map((r) => structuredClone(r)),
        ),
    };
  }

  /** Throws unless every handle came from writeResource. */
  checkHandles(handles: object[]) {
    const made = handles.filter((h) => !this.issued.has(h));
    if (made.length > 0) {
      throw new Error(`Handles swamp never issued: ${JSON.stringify(made)}`);
    }
  }

  /** The latest data of one instance. */
  data(name: string): Record<string, unknown> | undefined {
    return this.latest().find((r) => r.name === name)?.attributes;
  }
}
