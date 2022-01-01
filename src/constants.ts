import * as path from 'path';

const folderName = path.basename(__dirname);
export const EXTENSION_ROOT_DIR = folderName;
export const NotebookCellScheme = 'vscode-notebook-cell';


export namespace Constants {
    export const OpenScratchPadInteractive = 'jupyter.notebookeditor.openInInteractive';
    export const OpenContextualHelp = 'jupyter.notebookeditor.openContextualHelp';
}

export namespace Identifiers {
    export const EmptyFileName = '2DB9B899-6519-4E1B-88B0-FA728A274115';
    export const GeneratedThemeName = 'ipython-theme'; // This needs to be all lower class and a valid class name.
    export const HistoryPurpose = 'history';
    export const RawPurpose = 'raw';
    export const PingPurpose = 'ping';
    export const MatplotLibDefaultParams = '_VSCode_defaultMatplotlib_Params';
    export const EditCellId = '3D3AB152-ADC1-4501-B813-4B83B49B0C10';
    export const SvgSizeTag = 'sizeTag={{0}, {1}}';
    export const InteractiveWindowIdentityScheme = 'history';
    export const DefaultCodeCellMarker = '# %%';
    export const DefaultCommTarget = 'jupyter.widget';
    export const ALL_VARIABLES = 'ALL_VARIABLES';
    export const KERNEL_VARIABLES = 'KERNEL_VARIABLES';
    export const DEBUGGER_VARIABLES = 'DEBUGGER_VARIABLES';
    export const MULTIPLEXING_DEBUGSERVICE = 'MULTIPLEXING_DEBUGSERVICE';
    export const RUN_BY_LINE_DEBUGSERVICE = 'RUN_BY_LINE_DEBUGSERVICE';
    export const REMOTE_URI = 'https://remote/';
    export const REMOTE_URI_ID_PARAM = 'id';
    export const REMOTE_URI_HANDLE_PARAM = 'uriHandle';
}
