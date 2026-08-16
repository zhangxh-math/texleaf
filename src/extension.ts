import * as vscode from "vscode";
import { BracketDecorationController } from "./bracketDecorations";
import { CitationController } from "./citationController";
import { registerCompletionProvider } from "./completionProvider";
import { readConfig } from "./config";
import { EditorController } from "./editorController";
import { MathPreviewController } from "./mathPreviewController";
import { SnippetRepository } from "./snippetRepository";
import { registerSnippetEditorPanel } from "./snippetEditorPanel";
import { SnippetRuntime } from "./snippetRuntime";
import { SnippetSyncController } from "./snippetSync";
import { SnippetTreeProvider } from "./snippetTree";
import { TemplateManager } from "./templateManager";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("TeXLeaf", { log: true });
  context.subscriptions.push(output);

  const repository = new SnippetRepository(context);
  context.subscriptions.push(repository);
  await repository.initialize();

  const templates = new TemplateManager(context, output);
  context.subscriptions.push(templates);
  await templates.initialize();

  const snippetEditor = registerSnippetEditorPanel(context, {
    onWillOpen: () => repository.ensureGlobalSnippetFile(),
    onDidSave: async () => {
      await repository.reload();
      if (!(await repository.isGlobalSnippetFileCurrent())) {
        throw new Error(
          "全局 Snippet 文件未通过 JSONC 解析；TeXLeaf 仍在使用上一次有效内容。",
        );
      }
    },
    onRestoreDefaults: () => repository.restoreDefaultSnippets(),
    onReadLibrary: () => repository.readGlobalLibraryModel(),
    onReplaceLibrary: (model, expectedRevision) =>
      repository.replaceGlobalLibraryModel(model, expectedRevision),
    onListTemplates: () => templates.listTemplates(),
    onReplaceTemplates: (managedTemplates, expectedRevision) =>
      templates.replaceTemplates(managedTemplates, expectedRevision),
    onRestoreTemplates: () => templates.restoreDefaultTemplates(),
  });
  context.subscriptions.push(
    repository.onDidChange(() => {
      void snippetEditor.refreshCleanSessions();
    }),
    templates.onDidChange(() => {
      void snippetEditor.refreshCleanSessions();
    }),
  );

  const snippetSync = new SnippetSyncController(vscode, context, repository, {
    logger: output,
    isEditing: () => snippetEditor.hasUnsavedChanges(),
  });
  context.subscriptions.push(snippetSync);
  void snippetSync.start().catch((error: unknown) => {
    output.error(
      `Snippet Settings Sync 启动失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  const runtime = new SnippetRuntime(repository);
  runtime.configure(readConfig(vscode.window.activeTextEditor?.document.uri));
  context.subscriptions.push(runtime);

  const citations = new CitationController(runtime, output);
  citations.register();
  context.subscriptions.push(citations);

  const decorations = new BracketDecorationController();
  context.subscriptions.push(decorations);

  const mathPreview = new MathPreviewController(context, output);
  mathPreview.register();
  context.subscriptions.push(mathPreview);

  const treeProvider = new SnippetTreeProvider(repository);
  const tree = vscode.window.createTreeView("texleaf.snippets", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeProvider, tree);

  registerCompletionProvider(context, runtime);

  const editorController = new EditorController(
    context,
    repository,
    runtime,
    templates,
    {
      onEditorStateChanged: (editor) => decorations.schedule(editor),
    },
  );
  editorController.register();
  context.subscriptions.push(editorController);

  context.subscriptions.push(
    runtime.onDidChangeIssues((issues) => {
      if (issues.length === 0) {
        return;
      }
      output.warn(`${issues.length} 个片段定义未通过完整校验：`);
      for (const issue of issues.slice(0, 100)) {
        output.warn(`[${issue.code}] ${issue.path}: ${issue.message}`);
      }
    }),
  );

  if (runtime.validationIssues.length > 0) {
    output.warn(
      `启动时有 ${runtime.validationIssues.length} 个片段定义被跳过；详见此输出通道。`,
    );
  }
  output.info(
    `TeXLeaf 已激活：${repository.snapshot.snippets.length} 条定义，${runtime.compiledSnippets.length} 条可用片段。`,
  );
  decorations.schedule(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // VS Code disposes everything registered in ExtensionContext.subscriptions.
}
