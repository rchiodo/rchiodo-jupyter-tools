'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import * as path from 'path';
import * as vscode from 'vscode';
import { logError } from './common/logging';
import { isNotebookCell } from './common/utils';
import { EXTENSION_ROOT_DIR, Identifiers } from './constants';
import { disposables } from './extension';
import { IExportedKernelService, JupyterAPI } from './jupyter-extension/types';
import { SharedMessages, MessageMapping, WindowMessages } from './messages';
import { StatusProvider } from './statusProvider';
import { Resource, IWebviewViewProvider, IStatusParticipant } from './types';
import { createCodeCell } from './ui/common/cellFactory';
import { CellState, ICell } from './ui/common/types';
import { SimpleMessageListener } from './webviews/simpleMessageListener';

import { WebviewViewHost } from './webviews/webviewViewHost';

const root = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// This is the client side host for the contextual help (shown in the jupyter tab)
export class ContextualHelp extends WebviewViewHost<MessageMapping> implements vscode.Disposable, IStatusParticipant {
    private vscodeWebView: vscode.WebviewView | undefined;
    private unfinishedCells: ICell[] = [];
    private potentiallyUnfinishedStatus: vscode.Disposable[] = [];
    private notebookCellMap = new Map<string, ICell>();
    private kernelService: IExportedKernelService | undefined;

    protected get owningResource(): Resource {
        if (vscode.window.activeNotebookEditor?.document) {
            return vscode.window.activeNotebookEditor.document.uri;
        }
        return undefined;
    }
    constructor(provider: IWebviewViewProvider, private readonly statusProvider: StatusProvider) {
        super(provider, (c, d) => new SimpleMessageListener(c, d), root, [
            path.join(root, 'commons.initial.bundle.js'),
            path.join(root, 'contextualHelp.js')
        ]);

        // Sign up if the active variable view notebook is changed, restarted or updated
        vscode.window.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, disposables);
        vscode.window.onDidChangeTextEditorSelection(this.activeSelectionChanged, this, disposables);
    }

    // Used to identify this webview in telemetry, not shown to user so no localization
    // for webview views
    public get title(): string {
        return 'contextualHelp';
    }

    public showHelp(editor: vscode.TextEditor) {
        // Compute the text for the inspect request
        const range = editor.document.getWordRangeAtPosition(editor.selection.active);
        const text = editor.document.getText(range);

        // Make our inspect request
        this.inspect(text, editor.document);
    }

    public async load(codeWebview: vscode.WebviewView) {
        this.vscodeWebView = codeWebview;
        await super.loadWebview(process.cwd(), codeWebview).catch(logError);

        // Set the title if there is an active notebook
        if (this.vscodeWebView) {
            await this.activeEditorChanged(vscode.window.activeNotebookEditor);
        }

        // The UI requires us to say we have cells.
        this.postMessage(WindowMessages.LoadAllCells, {
            cells: [],
            isNotebookTrusted: true
        });
    }

    public startProgress() {
        this.postMessage(WindowMessages.StartProgress);
    }

    public stopProgress() {
        this.postMessage(WindowMessages.StopProgress);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case WindowMessages.Started:
                break;
            default:
                break;
        }

        // Pass onto our base class.
        super.onMessage(message, payload);
    }

    protected postMessage<M extends MessageMapping, T extends keyof M>(type: T, payload?: M[T]): Promise<void> {
        // Then send it to the webview
        return super.postMessage(type, payload);
    }

    // Handle message helper function to specifically handle our message mapping type
    protected handleMessage<M extends MessageMapping, T extends keyof M>(
        _message: T,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any,
        handler: (args: M[T]) => void
    ) {
        const args = payload as M[T];
        handler.bind(this)(args);
    }

    protected sendCellsToWebView(cells: ICell[]) {
        // Send each cell to the other side
        cells.forEach((cell: ICell) => {
            switch (cell.state) {
                case CellState.init:
                    // Tell the react controls we have a new cell
                    this.postMessage(WindowMessages.StartCell, cell);

                    // Keep track of this unfinished cell so if we restart we can finish right away.
                    this.unfinishedCells.push(cell);
                    break;

                case CellState.executing:
                    // Tell the react controls we have an update
                    this.postMessage(WindowMessages.UpdateCellWithExecutionResults, cell);
                    break;

                case CellState.error:
                case CellState.finished:
                    // Tell the react controls we're done
                    this.postMessage(WindowMessages.FinishCell, {
                        cell,
                        notebookIdentity: this.owningResource!
                    });

                    // Remove from the list of unfinished cells
                    this.unfinishedCells = this.unfinishedCells.filter((c) => c.id !== cell.id);
                    break;

                default:
                    break; // might want to do a progress bar or something
            }
        });

        // Update our current cell state
        if (this.owningResource) {
            this.notebookCellMap.set(this.owningResource.toString(), cells[0]);
        }
    }

    protected setStatus = (message: string, showInWebView: boolean): vscode.Disposable => {
        const result = this.statusProvider.set(message, showInWebView, undefined, undefined, this);
        this.potentiallyUnfinishedStatus.push(result);
        return result;
    };

    protected async inspect(code: string, document: vscode.TextDocument): Promise<boolean> {
        let result = true;
        // Skip if notebook not set
        if (!this.owningResource) {
            return result;
        }

        // Start a status item
        const status = this.setStatus('Executing code', false);

        try {
            // Make sure we're loaded first.
            const kernel = await this.getKernel(document);

            const result =
                kernel && code && code.length > 0
                    ? await kernel.connection.connection.requestInspect({ code, cursor_pos: 0, detail_level: 1 })
                    : undefined;
            if (result && result.content.status === 'ok' && 'text/plain' in result.content.data) {
                const output: nbformat.IStream = {
                    output_type: 'stream',
                    text: [result.content.data['text/plain']!.toString()],
                    name: 'stdout',
                    metadata: {},
                    execution_count: 1
                };

                // Turn this into a cell (shortcut to displaying it)
                const cell: ICell = {
                    id: '1',
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.finished,
                    data: createCodeCell([''], [output])
                };
                cell.data.execution_count = 1;

                // Then send the combined output to the UI
                this.sendCellsToWebView([cell]);
            } else {
                // Otherwise empty it out.
                const cell: ICell = {
                    id: '1',
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.finished,
                    data: createCodeCell('')
                };
                cell.data.execution_count = 1;

                // Then send the combined output to the UI
                this.sendCellsToWebView([cell]);
            }
        } finally {
            status.dispose();
        }

        return result;
    }

    private async activeEditorChanged(editor: vscode.NotebookEditor | undefined) {
        // Update the state of the control based on editor
        await this.postMessage(WindowMessages.HideUI, editor === undefined);

        // Show help right now if the active text editor is a notebook cell
        if (vscode.window.activeTextEditor && isNotebookCell(vscode.window.activeTextEditor.document)) {
            this.showHelp(vscode.window.activeTextEditor);
        }
    }
    private async activeSelectionChanged(e: vscode.TextEditorSelectionChangeEvent) {
        if (isNotebookCell(e.textEditor.document)) {
            this.showHelp(e.textEditor);
        }
    }
    private async activeKernelChanged() {
        // Show help right now if the active text editor is a notebook cell
        if (vscode.window.activeTextEditor && isNotebookCell(vscode.window.activeTextEditor.document)) {
            this.showHelp(vscode.window.activeTextEditor);
        }
    }

    private async getKernel(document: vscode.TextDocument) {
        // Find matching notebook if there is one
        const notebook = vscode.workspace.notebookDocuments.find((n) =>
            n.getCells().find((c) => c.document.uri.toString() === document.uri.toString())
        );
        if (!this.kernelService) {
            if (notebook) {
                // Load the jupyter extension if possible
                const extension = vscode.extensions.getExtension('ms-toolsai.jupyter');
                if (extension) {
                    await extension.activate();
                    const exports = extension.exports as JupyterAPI;
                    if (exports && (exports as any).getKernelService) {
                        this.kernelService = await exports.getKernelService();
                        this.kernelService?.onDidChangeKernels(this.activeKernelChanged, this, disposables);
                    }
                }
            }
        }
        if (this.kernelService && notebook) {
            return this.kernelService.getKernel(notebook);
        }
    }
}