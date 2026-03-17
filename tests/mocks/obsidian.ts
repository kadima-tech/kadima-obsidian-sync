import { EventEmitter } from "events";
import { normalizePath } from "obsidian";

export abstract class TAbstractFile {
    constructor(
        public vault: FakeVault,
        public path: string,
        public name: string,
        public parent: TFolder | null
    ) {}
}

export class TFile extends TAbstractFile {
  constructor(
    vault: FakeVault,
    path: string,
    name: string,
    public extension: string,
    public basename: string,
    parent: TFolder | null
  ) {
      super(vault, path, name, parent);
  }
}

export class TFolder extends TAbstractFile {
  constructor(
    vault: FakeVault,
    path: string,
    name: string,
    parent: TFolder | null,
    public children: (TFile | TFolder)[] = []
  ) {
      super(vault, path, name, parent);
  }
}

export class FakeVault extends EventEmitter {
  private files = new Map<string, string | ArrayBuffer>();
  private abstractFiles = new Map<string, TAbstractFile>();

  constructor(private name: string = "Test Vault") {
    super();
    this.abstractFiles.set("", new TFolder(this, "", "", null));
  }

  getName() {
    return this.name;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.abstractFiles.get(normalizePath(path)) || null;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return Array.from(this.abstractFiles.values());
  }

  async read(file: TFile): Promise<string> {
    const data = this.files.get(file.path);
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    throw new Error("File not found or binary");
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const data = this.files.get(file.path);
    if (data instanceof ArrayBuffer) return data;
    if (typeof data === "string") return new TextEncoder().encode(data).buffer;
    throw new Error("File not found");
  }

  async create(path: string, data: string): Promise<TFile> {
    const normalized = normalizePath(path);
    if (this.abstractFiles.has(normalized)) throw new Error("File already exists");
    
    const parts = normalized.split("/");
    const name = parts.pop()!;
    const extension = name.includes(".") ? name.split(".").pop()! : "";
    const basename = name.includes(".") ? name.split(".").slice(0, -1).join(".") : name;
    
    const file = new TFile(this, normalized, name, extension, basename, null);
    this.abstractFiles.set(normalized, file);
    this.files.set(normalized, data);
    this.emit("create", file);
    return file;
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const normalized = normalizePath(path);
    if (this.abstractFiles.has(normalized)) throw new Error("File already exists");

    const parts = normalized.split("/");
    const name = parts.pop()!;
    const extension = name.includes(".") ? name.split(".").pop()! : "";
    const basename = name.includes(".") ? name.split(".").slice(0, -1).join(".") : name;

    const file = new TFile(this, normalized, name, extension, basename, null);
    this.abstractFiles.set(normalized, file);
    this.files.set(normalized, data);
    this.emit("create", file);
    return file;
  }

  async modify(file: TFile, data: string): Promise<void> {
    this.files.set(file.path, data);
    this.emit("modify", file);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    this.files.set(file.path, data);
    this.emit("modify", file);
  }

  async delete(file: TFile, force?: boolean): Promise<void> {
    this.abstractFiles.delete(file.path);
    this.files.delete(file.path);
    this.emit("delete", file);
  }

  async copy(file: TFile, newPath: string): Promise<TFile> {
    const data = this.files.get(file.path);
    if (data === undefined) throw new Error("Source file not found");
    if (typeof data === "string") return this.create(newPath, data);
    return this.createBinary(newPath, data);
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const oldPath = file.path;
    const normalized = normalizePath(newPath);
    const data = this.files.get(oldPath);
    
    this.abstractFiles.delete(oldPath);
    this.files.delete(oldPath);
    
    file.path = normalized;
    const parts = normalized.split("/");
    file.name = parts.pop()!;
    file.extension = file.name.includes(".") ? file.name.split(".").pop()! : "";
    file.basename = file.name.includes(".") ? file.name.split(".").slice(0, -1).join(".") : file.name;
    
    this.abstractFiles.set(normalized, file);
    if (data !== undefined) this.files.set(normalized, data);
    
    this.emit("rename", file, oldPath);
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (this.abstractFiles.has(normalized)) return;
    const folder = new TFolder(this, normalized, normalized.split("/").pop()!, null);
    this.abstractFiles.set(normalized, folder);
  }

  // Helper for tests to setup initial state
  __setupFile(path: string, content: string | ArrayBuffer) {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    const name = parts.pop()!;
    const extension = name.includes(".") ? name.split(".").pop()! : "";
    const basename = name.includes(".") ? name.split(".").slice(0, -1).join(".") : name;
    const file = new TFile(this, normalized, name, extension, basename, null);
    this.abstractFiles.set(normalized, file);
    this.files.set(normalized, content);
  }
}

export class FakeApp {
  public vault: FakeVault;
  public workspace = {
    onLayoutReady: (cb: () => void) => setTimeout(cb, 0)
  };

  constructor(vaultName: string = "Test Vault") {
    this.vault = new FakeVault(vaultName);
  }
}

export const Notice = class {
  constructor(public message: string) {
    // console.log("[Notice]", message);
  }
};
