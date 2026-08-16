import * as vscode from "vscode";

export interface BibliographySnapshot {
  readonly uri: vscode.Uri;
  readonly exists: boolean;
  readonly text: string;
  readonly document: vscode.TextDocument | undefined;
  readonly wasDirty: boolean;
}

/** Resolves and reads the bibliography associated with a TeX document. */
export class CitationRepository {
  public async resolveBibliographyUri(
    texDocument: vscode.TextDocument,
    configuredPath: string,
  ): Promise<vscode.Uri> {
    const relativePath = validateRelativeBibliographyPath(configuredPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(texDocument.uri);
    const workspaceRoot = workspaceFolder?.uri;
    const documentDirectory = vscode.Uri.joinPath(texDocument.uri, "..");

    if (relativePath.includes("/")) {
      return vscode.Uri.joinPath(workspaceRoot ?? documentDirectory, ...relativePath.split("/"));
    }

    // For the default/simple filename, prefer the nearest existing file while
    // walking from the TeX file to its owning workspace root. This supports
    // monorepos without ever crossing into another workspace folder.
    let directory = documentDirectory;
    while (true) {
      const candidate = vscode.Uri.joinPath(directory, relativePath);
      if (await uriExists(candidate)) {
        return candidate;
      }
      if (workspaceRoot === undefined || sameUri(directory, workspaceRoot)) {
        break;
      }
      const parent = vscode.Uri.joinPath(directory, "..");
      if (sameUri(parent, directory) || !isUriWithin(parent, workspaceRoot)) {
        break;
      }
      directory = parent;
    }

    return vscode.Uri.joinPath(workspaceRoot ?? documentDirectory, relativePath);
  }

  public async read(uri: vscode.Uri): Promise<BibliographySnapshot> {
    const openDocument = findOpenDocument(uri);
    if (openDocument !== undefined) {
      return {
        uri,
        exists: true,
        text: openDocument.getText(),
        document: openDocument,
        wasDirty: openDocument.isDirty,
      };
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return {
        uri,
        exists: true,
        text: decodeUtf8(bytes, uri),
        document: undefined,
        wasDirty: false,
      };
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        return {
          uri,
          exists: false,
          text: "",
          document: undefined,
          wasDirty: false,
        };
      }
      throw error;
    }
  }

  public async openForEditing(
    snapshot: BibliographySnapshot,
  ): Promise<vscode.TextDocument> {
    if (!snapshot.exists) {
      const parent = vscode.Uri.joinPath(snapshot.uri, "..");
      await vscode.workspace.fs.createDirectory(parent);
      const createEdit = new vscode.WorkspaceEdit();
      createEdit.createFile(snapshot.uri, {
        ignoreIfExists: true,
        overwrite: false,
      });
      if (!(await vscode.workspace.applyEdit(createEdit))) {
        throw new Error(
          `VS Code 无法创建参考文献文件：${snapshot.uri.toString()}。`,
        );
      }
    }
    return vscode.workspace.openTextDocument(snapshot.uri);
  }
}

export function validateRelativeBibliographyPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("://") ||
    segments.some((segment) => segment === "." || segment === "..") ||
    !normalized.toLowerCase().endsWith(".bib")
  ) {
    throw new Error(
      "参考文献文件必须是工作区内不含 '..' 的相对 .bib 路径。",
    );
  }
  return segments.join("/");
}

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const target = uri.toString();
  return vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === target,
  );
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

function decodeUtf8(bytes: Uint8Array, uri: vscode.Uri): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${uri.fsPath || uri.path} 不是有效的 UTF-8 文件。`);
  }
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  if (left.scheme !== right.scheme || left.authority !== right.authority) {
    return false;
  }
  return comparableUriPath(left) === comparableUriPath(right);
}

function isUriWithin(candidate: vscode.Uri, root: vscode.Uri): boolean {
  if (candidate.scheme !== root.scheme || candidate.authority !== root.authority) {
    return false;
  }
  const candidatePath = comparableUriPath(candidate);
  const rootPath = comparableUriPath(root);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function normalizeUriPath(value: string): string {
  const absolute = value.startsWith("/");
  const result: string[] = [];
  for (const segment of value.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      result.pop();
      continue;
    }
    result.push(segment);
  }
  const normalized = `${absolute ? "/" : ""}${result.join("/")}`;
  return normalized || (absolute ? "/" : ".");
}

function comparableUriPath(uri: vscode.Uri): string {
  const normalized = normalizeUriPath(uri.path);
  return uri.scheme === "file" && process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}
